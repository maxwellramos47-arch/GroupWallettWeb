const GastoDAL = require('../DAL/gasto.dal');
const GrupoDAL = require('../DAL/grupo.dal');
const UsuarioDAL = require('../DAL/usuario.dal');
const { generarFirmaHMAC } = require('../Middleware/security.util');
const webpush = require('web-push');
const { safeDecrypt } = require('../Middleware/security.util');
const EmailTemplates = require('../Routes/emailTemplates');
const nodemailer = require('nodemailer');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

class GastoBLL {
    static async obtenerGastos(id_usuario) {
        return await GastoDAL.getAll(id_usuario);
    }

    static async crearGasto(id_grupo, descripcion, categoria, monto, pagador, participantes, fecha, comprobante_url, id_solicitante) {
        if (!id_grupo || !descripcion || !monto || !pagador || !participantes || participantes.length === 0) throw new Error('Faltan datos requeridos.');
        
        const rol = await GrupoDAL.getMemberRole(id_grupo, id_solicitante);
        const user = await UsuarioDAL.findById(id_solicitante);
        const isGod = user.estado_suscripcion === 'GOD_MODE';
        if (rol !== 'Administrador' && !isGod) throw new Error('Acceso denegado. Solo los administradores pueden crear gastos.');

        const firma = generarFirmaHMAC(`${pagador}-${monto}-${descripcion}-${categoria}`);
        
        const nuevoGasto = await GastoDAL.createGastoTransaction(id_grupo, pagador, monto, descripcion, categoria, comprobante_url, firma, fecha, participantes);
        
        const payloadPush = JSON.stringify({
            title: '💸 Nuevo cobro registrado',
            body: `Te han asignado una cuota por: ${descripcion}. ¡Abre GroupWallet para revisar!`,
            url: '/dashboard.html'
        });

        for (let p of participantes) {
            if (p != pagador) {
                try {
                    const subStr = await UsuarioDAL.getPushSubscription(parseInt(p));
                    if (subStr) await webpush.sendNotification(JSON.parse(subStr), payloadPush);
                } catch (error) { console.error(`No se pudo notificar al usuario ${p}`); }
            }
        }
        
        return nuevoGasto;
    }

    static async eliminarGasto(id_transaccion, id_solicitante) {
        const info = await GastoDAL.getGastoInfoAuth(id_transaccion, id_solicitante);
        if (!info) throw new Error('Gasto no encontrado.');
        const user = await UsuarioDAL.findById(id_solicitante);
        const isGod = user.estado_suscripcion === 'GOD_MODE';
        if (info.rol !== 'Administrador' && info.id_usuario_pagador != id_solicitante && !isGod) throw new Error('Acceso denegado. No tienes permiso.');
        
        if (await GastoDAL.countPagos(id_transaccion) > 0) throw new Error('No se puede eliminar porque uno o más participantes ya han pagado.');
        await GastoDAL.delete(id_transaccion);

        // --- Eliminar el comprobante de AWS S3 si existe ---
        if (info.comprobante_url && info.comprobante_url.includes('amazonaws.com')) {
            try {
                // Extraer el 'Key' (ruta interna del archivo) de la URL pública
                // Ej: https://mi-bucket.../archivos_adjuntos/img.jpg -> archivos_adjuntos/img.jpg
                const urlObj = new URL(info.comprobante_url);
                const fileKey = decodeURIComponent(urlObj.pathname.substring(1)); // Quitar el '/' inicial

                const s3Client = new S3Client({ region: process.env.AWS_REGION });
                const command = new DeleteObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: fileKey
                });
                
                await s3Client.send(command);
            } catch (s3Error) {
                console.error('⚠️ Error al intentar eliminar archivo huérfano de S3:', s3Error.message);
            }
        }
    }

    static async editarGasto(id_transaccion, descripcion, categoria, monto, id_solicitante) {
        if (!descripcion || isNaN(monto) || parseFloat(monto) <= 0) throw new Error('Datos inválidos.');
        const info = await GastoDAL.getGastoInfoAuth(id_transaccion, id_solicitante);
        if (!info) throw new Error('Gasto no encontrado.');
        const user = await UsuarioDAL.findById(id_solicitante);
        const isGod = user.estado_suscripcion === 'GOD_MODE';
        if (info.rol !== 'Administrador' && info.id_usuario_pagador != id_solicitante && !isGod) throw new Error('Acceso denegado.');
        
        if (await GastoDAL.countPagos(id_transaccion) > 0) throw new Error('No se puede editar porque uno o más participantes ya han pagado.');
        await GastoDAL.update(id_transaccion, descripcion, categoria, parseFloat(monto), generarFirmaHMAC(`${info.id_usuario_pagador}-${parseFloat(monto)}-${descripcion}-${categoria}`));
    }

    static async actualizarComprobante(id_transaccion, comprobante_url, id_solicitante) {
        if (!comprobante_url) throw new Error('Falta la URL del comprobante.');
        const info = await GastoDAL.getGastoInfoAuth(id_transaccion, id_solicitante);
        
        if (!info) {
            const inGroup = await GastoDAL.checkUserInGroupTransaccion(id_transaccion, id_solicitante);
            if (!inGroup) throw new Error('Acceso denegado o transacción no encontrada.');
        } else {
            const user = await UsuarioDAL.findById(id_solicitante);
            const isGod = user.estado_suscripcion === 'GOD_MODE';
            if (info.rol !== 'Administrador' && info.id_usuario_pagador != id_solicitante && !isGod) throw new Error('Solo el pagador o el administrador pueden adjuntar comprobantes.');
        }

        await GastoDAL.updateComprobante(id_transaccion, comprobante_url);
    }

    static async pagarCuota(id_transaccion, id_usuario, id_solicitante) {
        if (!await GastoDAL.checkUserInGroupTransaccion(id_transaccion, id_solicitante)) throw new Error('Acceso denegado. No perteneces al grupo.');
        if (!await GastoDAL.updateCuotaPagada(id_transaccion, id_usuario)) throw new Error('Cuota no encontrada.');

        const pendientes = await GastoDAL.countPendientes(id_transaccion);
        if (pendientes === 0) await GastoDAL.archiveGasto(id_transaccion);
        
        return pendientes === 0;
    }

    static async pagarCuotaInApp(id_transaccion, id_usuario, id_solicitante) {
        if (!await GastoDAL.checkUserInGroupTransaccion(id_transaccion, id_solicitante)) throw new Error('Acceso denegado. No perteneces al grupo.');
        if (id_usuario != id_solicitante) throw new Error('Solo puedes pagar tus propias cuotas a través de la app.');
        
        const info = await GastoDAL.getMontoCuota(id_transaccion);
        if (!info) throw new Error('Transacción no encontrada.');

        const montoBase = parseFloat(info.monto) / parseInt(info.total_participantes);
        const comision = montoBase * 0.0089;
        const total = montoBase + comision;

        const archivado = await GastoDAL.registerInAppPaymentAndArchive(id_transaccion, id_usuario, info.id_receptor, montoBase, comision, total);
        
        return { archivado, montoBase, comision, total };
    }

    static async notificarPagoManualPorWhatsApp(id_transaccion, id_deudor_notificador) {
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
            throw new Error('La integración con Twilio no está configurada en el servidor.');
        }

        const gasto = await GastoDAL.getGastoDetailsForNotification(id_transaccion);
        if (!gasto) throw new Error('Transacción no encontrada para notificar.');

        const deudor = gasto.participantes.find(p => p.id_usuario == id_deudor_notificador);
        if (!deudor) throw new Error('El usuario notificador no es parte de este gasto.');

        const acreedor = gasto.pagador;
        const telefonoAcreedor = safeDecrypt(acreedor.telefono);

        if (!telefonoAcreedor) {
            return { message: 'Notificación no enviada: El acreedor no tiene un número de teléfono registrado.' };
        }

        const twilio = require('twilio');
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';

        const montoCuota = parseFloat(gasto.monto) / gasto.participantes.length;
        const mensaje = `¡Hola ${acreedor.nombre}! ✅ ${deudor.nombre} ha marcado como pagada su cuota de $${montoCuota.toFixed(2)} por el gasto "${gasto.descripcion}" en GroupWallet.`;

        try {
            const numeroLimpio = telefonoAcreedor.replace(/[^0-9+]/g, '');
            await client.messages.create({ body: mensaje, from: fromWhatsApp, to: `whatsapp:${numeroLimpio}` });
            return { message: 'Notificación de pago enviada por WhatsApp exitosamente.' };
        } catch (error) {
            console.error(`Error Twilio al notificar pago a ${acreedor.nombre}:`, error.message);
            throw new Error('No se pudo enviar la notificación por WhatsApp.');
        }
    }

    static async notificarPagoManualPorEmail(id_transaccion, id_deudor_notificador) {
        const gasto = await GastoDAL.getGastoDetailsForNotification(id_transaccion);
        if (!gasto) throw new Error('Transacción no encontrada para notificar.');

        const deudor = gasto.participantes.find(p => p.id_usuario == id_deudor_notificador);
        if (!deudor) throw new Error('El usuario notificador no es parte de este gasto.');

        const acreedor = gasto.pagador;
        if (!acreedor.correo) return { message: 'Notificación no enviada: El acreedor no tiene un correo registrado.' };

        const montoCuota = parseFloat(gasto.monto) / gasto.participantes.length;

        try {
            const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
            const mailOptions = { from: `"GroupWallet" <${process.env.SMTP_USER}>`, to: acreedor.correo, subject: `✅ ${deudor.nombre} ha pagado su cuota`, html: EmailTemplates.notificacionPagoCuota(acreedor.nombre, deudor.nombre, montoCuota, gasto.descripcion) };
            await transporter.sendMail(mailOptions);
            return { message: 'Notificación de pago enviada por correo exitosamente.' };
        } catch (error) {
            console.error(`Error al enviar correo de notificación de pago a ${acreedor.nombre}:`, error);
            throw new Error('No se pudo enviar la notificación por correo.');
        }
    }
}
module.exports = GastoBLL;