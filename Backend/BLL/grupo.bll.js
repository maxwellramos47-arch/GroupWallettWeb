const GrupoDAL = require('../DAL/grupo.dal');
const jwt = require('jsonwebtoken');
const { JWT_SECRET, safeDecrypt } = require('../Middleware/security.util');

class GrupoBLL {
    static async crearGrupo(nombre_grupo, id_creador) {
        const limits = await GrupoDAL.getUserPlanLimits(id_creador);
        if (parseInt(limits.grupos_creados) >= limits.limite_grupos) {
            throw new Error('Has alcanzado el límite de grupos de tu plan actual. ¡Mejora a Premium para grupos ilimitados!');
        }
        const nuevo_id = await GrupoDAL.create(nombre_grupo, id_creador);
        await GrupoDAL.addMember(nuevo_id, id_creador, 'Administrador');
        return nuevo_id;
    }

    static async obtenerGrupos(id_usuario) {
        return await GrupoDAL.getUserGroups(id_usuario);
    }

    static async obtenerMiembros(id_grupo) {
        const miembros = await GrupoDAL.getMembers(id_grupo);
        return miembros.map(m => ({
            ...m,
            telefono: safeDecrypt(m.telefono)
        }));
    }

    static async editarGrupo(id_grupo, id_solicitante, nombre_grupo) {
        if (!nombre_grupo || nombre_grupo.trim() === '') throw new Error('El nombre del grupo no puede estar vacío.');
        const rol = await GrupoDAL.getMemberRole(id_grupo, id_solicitante);
        if (rol !== 'Administrador') throw new Error('Acceso denegado. Solo los administradores pueden editar el grupo.');
        await GrupoDAL.updateName(id_grupo, nombre_grupo);
    }

    static async generarInvitacion(id_grupo, id_solicitante) {
        const rol = await GrupoDAL.getMemberRole(id_grupo, id_solicitante);
        if (rol !== 'Administrador') throw new Error('Solo los administradores pueden generar enlaces de invitación.');
        
        const limits = await GrupoDAL.getGroupCreatorPlanLimits(id_grupo);
        if (limits && limits.miembros_actuales >= limits.limite_miembros) {
            throw new Error(`Has alcanzado el límite de ${limits.limite_miembros} miembros en este grupo. ¡Mejora a Premium para invitar a más amigos!`);
        }
        
        return jwt.sign({ accion: 'invitacion', id_grupo: id_grupo }, JWT_SECRET, { expiresIn: '7d' });
    }

    static async enviarInvitacionDirecta(id_grupo, id_solicitante, correo, telefono, hostUrl) {
        const inviteToken = await this.generarInvitacion(id_grupo, id_solicitante);
        const inviteUrl = `${hostUrl}/join.html?token=${inviteToken}`;
        
        const prisma = require('../Config/prisma');
        const grupo = await prisma.grupos.findUnique({ where: { id_grupo: parseInt(id_grupo) } });
        const usuario = await prisma.usuarios.findUnique({ where: { id_usuario: parseInt(id_solicitante) } });
        
        if (correo) {
            const nodemailer = require('nodemailer');
            const EmailTemplates = require('../Routes/emailTemplates');
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: process.env.SMTP_PORT || 587,
                secure: false,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });
            const mailOptions = {
                from: `"GroupWallet" <${process.env.SMTP_USER}>`,
                to: correo,
                subject: `Invitación a "${grupo.nombre_grupo}"`,
                html: EmailTemplates.invitacionGrupo(usuario.nombre, grupo.nombre_grupo, inviteUrl)
            };
            await transporter.sendMail(mailOptions);
        }
        
        if (telefono && process.env.TWILIO_ACCOUNT_SID) {
            const twilio = require('twilio');
            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER;
            
            const numeroLimpio = telefono.startsWith('+') ? telefono : '+' + telefono;
            const mensaje = `¡Hola! ${usuario.nombre} te invita a unirte a "${grupo.nombre_grupo}" en GroupWallet. Divide tus gastos fácil y rápido ingresando aquí: ${inviteUrl}`;
            
            // Preferimos WhatsApp si está configurado
            if (fromWhatsApp && fromWhatsApp.includes('whatsapp:')) {
                await client.messages.create({ body: mensaje, from: fromWhatsApp, to: `whatsapp:${numeroLimpio}` });
            } else {
                await client.messages.create({ body: mensaje, from: process.env.TWILIO_PHONE_NUMBER, to: numeroLimpio });
            }
        }
    }

    static async unirseGrupo(token_invitacion, id_usuario) {
        let decoded;
        try { decoded = jwt.verify(token_invitacion, JWT_SECRET); } 
        catch (e) { throw new Error('El enlace de invitación ha expirado o está corrupto.'); }
        
        if (decoded.accion !== 'invitacion' || !decoded.id_grupo) throw new Error('Token de invitación inválido.');
        
        const rolExistente = await GrupoDAL.getMemberRole(decoded.id_grupo, id_usuario);
        if (rolExistente) throw new Error('Ya eres miembro de este grupo.');
        
        const limits = await GrupoDAL.getGroupCreatorPlanLimits(decoded.id_grupo);
        if (limits && limits.miembros_actuales >= limits.limite_miembros) {
            throw new Error(`Este grupo ha alcanzado el límite máximo de ${limits.limite_miembros} miembros permitido por el plan Básico.`);
        }
        
        await GrupoDAL.addMember(decoded.id_grupo, id_usuario, 'Miembro');
        return decoded.id_grupo;
    }

    static async liquidarDeudas(id_grupo, id_solicitante) {
        const rol = await GrupoDAL.getMemberRole(id_grupo, id_solicitante);
        if (!rol) throw new Error('No tienes acceso a este grupo.');

        const deudas = await GrupoDAL.getPendingDebts(id_grupo);
        
        // 1. Calcular el balance neto de cada usuario
        const balances = {};
        for (const d of deudas) {
            const monto = parseFloat(d.monto);
            if (!balances[d.id_acreedor]) balances[d.id_acreedor] = { nombre: d.acreedor_nombre, balance: 0 };
            if (!balances[d.id_deudor]) balances[d.id_deudor] = { nombre: d.deudor_nombre, balance: 0 };
            
            balances[d.id_acreedor].balance += monto;
            balances[d.id_deudor].balance -= monto;
        }
        
        // 2. Separar a los que deben dinero (Deudores) de los que deben recibir (Acreedores)
        const deudores = [];
        const acreedores = [];
        for (const id in balances) {
            const b = balances[id];
            if (b.balance < -0.01) deudores.push({ id, nombre: b.nombre, monto: Math.abs(b.balance) });
            else if (b.balance > 0.01) acreedores.push({ id, nombre: b.nombre, monto: b.balance });
        }
        
        // Ordenar de mayor a menor para emparejar grandes deudas rápido
        deudores.sort((a, b) => b.monto - a.monto);
        acreedores.sort((a, b) => b.monto - a.monto);
        
        // 3. Emparejar (Greedy Algorithm)
        const transferencias = [];
        let i = 0, j = 0;
        while (i < deudores.length && j < acreedores.length) {
            const deudor = deudores[i], acreedor = acreedores[j];
            const montoTransferir = Math.min(deudor.monto, acreedor.monto);
            transferencias.push({ id_deudor: deudor.id, deudor: deudor.nombre, id_acreedor: acreedor.id, acreedor: acreedor.nombre, monto: montoTransferir });
            deudor.monto -= montoTransferir;
            acreedor.monto -= montoTransferir;
            if (deudor.monto < 0.01) i++;
            if (acreedor.monto < 0.01) j++;
        }
        return transferencias;
    }

    static async registrarPagoTransferencia(id_grupo, id_deudor, id_acreedor, monto, id_solicitante) {
        const rol = await GrupoDAL.getMemberRole(id_grupo, id_solicitante);
        if (!rol) throw new Error('No tienes acceso a este grupo.');
        if (id_solicitante != id_deudor && id_solicitante != id_acreedor && rol !== 'Administrador') {
            throw new Error('Solo los involucrados o un administrador pueden marcar esta deuda como pagada.');
        }

        // Para nivelar los saldos sin perder el historial, creamos una contra-transacción de "Ajuste"
        // Si Deudor paga $X, y Acreedor es el participante de la contra-transacción, Acreedor le "debe" a Deudor $X. 
        // Matemáticamente esto anula la deuda de $X que tenía el Deudor originalmente.
        const descripcion = `Liquidación de deuda`;
        const categoria = `General`;
        const firma = generarFirmaHMAC(`${id_deudor}-${monto}-${descripcion}-${categoria}`);
        
        const GastoDAL = require('../DAL/gasto.dal');
        const nuevaTx = await GastoDAL.createGastoTransaction(id_grupo, id_deudor, monto, descripcion, categoria, null, firma, new Date().toISOString(), [id_acreedor]);
        await GastoDAL.updateCuotaPagada(nuevaTx.id_transaccion, id_acreedor);
        await GastoDAL.archiveGasto(nuevaTx.id_transaccion);
    }

    static async enviarResumenWhatsApp(id_grupo, id_solicitante, transferencias) {
        const rol = await GrupoDAL.getMemberRole(id_grupo, id_solicitante);
        if (!rol) throw new Error('No tienes acceso a este grupo.');

        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
            throw new Error('La integración con Twilio no está configurada en el servidor.');
        }

        const twilio = require('twilio');
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const fromWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886'; // Número de Sandbox de Twilio

        let mensajeWhatsApp = `*💸 Resumen de Liquidación - GroupWallet*\n\nPara resolver todas las deudas del grupo, sigan este plan:\n`;
        transferencias.forEach(t => {
            mensajeWhatsApp += `🔸 *${t.deudor}* debe pagarle a *${t.acreedor}*: $${t.monto.toFixed(2)}\n`;
        });
        mensajeWhatsApp += `\n_Generado automáticamente por GroupWallet_`;

        const miembros = await GrupoDAL.getMembersWithPhones(id_grupo);
        let enviados = 0;

        for (const miembro of miembros) {
            const telefonoLimpio = safeDecrypt(miembro.telefono);
            if (telefonoLimpio) {
                try {
                    // Twilio exige el formato "whatsapp:+1234567890"
                    const numeroLimpio = telefonoLimpio.startsWith('+') ? telefonoLimpio : '+' + telefonoLimpio;
                    await client.messages.create({ body: mensajeWhatsApp, from: fromWhatsApp, to: `whatsapp:${numeroLimpio}` });
                    enviados++;
                } catch (error) { console.error(`Error Twilio a ${miembro.nombre}:`, error.message); }
            }
        }
        return enviados;
    }

    static async expulsarMiembro(id_grupo, id_usuario_a_expulsar, id_solicitante) {
        const rolSolicitante = await GrupoDAL.getMemberRole(id_grupo, id_solicitante);
        if (rolSolicitante !== 'Administrador') throw new Error('Solo los administradores pueden expulsar miembros.');
        
        if (id_solicitante == id_usuario_a_expulsar) throw new Error('No puedes expulsarte a ti mismo.');

        const rolObjetivo = await GrupoDAL.getMemberRole(id_grupo, id_usuario_a_expulsar);
        if (!rolObjetivo) throw new Error('El usuario no pertenece al grupo.');

        await GrupoDAL.removeMember(id_grupo, id_usuario_a_expulsar);
    }
}
module.exports = GrupoBLL;