const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UsuarioDAL = require('../DAL/usuario.dal');
const { JWT_SECRET, safeEncrypt, safeDecrypt, generarFirmaHMAC } = require('../Middleware/security.util');
const twilio = require('twilio');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

class UsuarioBLL {
    static async generarTokenVerificacion(telefono) {
        const regexTelefono = /^\+[1-9]\d{7,14}$/;
        if (!regexTelefono.test(telefono.trim())) throw new Error('Formato de teléfono inválido.');
        
        const telefonoHash = generarFirmaHMAC(telefono.trim());
        const exists = await UsuarioDAL.findByIdentifier(telefonoHash);
        if (exists) throw new Error('El teléfono ya está registrado.');

        const codigoVerificacion = Math.floor(100000 + Math.random() * 900000).toString();
        const codeHash = generarFirmaHMAC(codigoVerificacion);
        
        // El token mantiene el secreto a salvo en el navegador
        const token = jwt.sign({ telefono, codeHash, type: 'sms_verification' }, JWT_SECRET, { expiresIn: '10m' });

        const numeroLimpio = telefono.replace(/[^0-9+]/g, '');
        if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
            throw new Error('El servicio de SMS no está configurado en el servidor.');
        }

        try {
            const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
            await client.messages.create({
                body: `Tu código de verificación para GroupWallet es: ${codigoVerificacion}`,
                from: process.env.TWILIO_PHONE_NUMBER,
                to: numeroLimpio
            });
        } catch (error) { 
            console.error('Error enviando SMS con Twilio:', error.message); 
            throw new Error('No se pudo enviar el SMS. Verifica que tu número sea válido.');
        }
        return { token };
    }

    static async generarTokenVerificacionEmail(correo) {
        const correoNormalizado = correo.toLowerCase().trim();
        const exists = await UsuarioDAL.findByIdentifier(correoNormalizado);
        if (exists) throw new Error('El correo ya está registrado.');

        const codigoVerificacion = Math.floor(100000 + Math.random() * 900000).toString();
        const codeHash = generarFirmaHMAC(codigoVerificacion);
        const token = jwt.sign({ correo: correoNormalizado, codeHash, type: 'email_verification' }, JWT_SECRET, { expiresIn: '10m' });

        const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: process.env.SMTP_PORT, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
        await transporter.sendMail({
            from: `"GroupWallet" <${process.env.SMTP_USER}>`,
            to: correoNormalizado,
            subject: 'Tu código de verificación - GroupWallet',
            html: `<h2>Código de Verificación</h2><p>Tu código es: <strong style="font-size: 24px;">${codigoVerificacion}</strong></p>`
        });
        return { token };
    }

    static async registrar(nombre, metodo, correo, telefono, password, verificationToken, codigoVerificacion, codigo_referido) {
        const passwordHash = await bcrypt.hash(password, 10);
        let telefonoSeguro = null;
        let telefonoHash = null;
        let telefono_verificado = false;
        let correoNormalizado = null;
        let correo_verificado = false;

        if (metodo === 'sms') {
            if (!telefono) throw new Error('Falta el teléfono.');
            const decoded = jwt.verify(verificationToken, JWT_SECRET);
            if (decoded.type !== 'sms_verification' || decoded.telefono !== telefono.trim()) throw new Error('Token de SMS inválido.');
            if (decoded.codeHash !== generarFirmaHMAC(codigoVerificacion)) throw new Error('Código SMS incorrecto.');
            telefonoSeguro = safeEncrypt(telefono.trim());
            telefonoHash = generarFirmaHMAC(telefono.trim());
            telefono_verificado = true;
        } else if (metodo === 'email') {
            if (!correo) throw new Error('Falta el correo.');
            correoNormalizado = correo.toLowerCase().trim();
            const decoded = jwt.verify(verificationToken, JWT_SECRET);
            if (decoded.type !== 'email_verification' || decoded.correo !== correoNormalizado) throw new Error('Token de correo inválido.');
            if (decoded.codeHash !== generarFirmaHMAC(codigoVerificacion)) throw new Error('Código de correo incorrecto.');
            correo_verificado = true;
        }

        let referido_por = null;
        if (codigo_referido && !isNaN(parseInt(codigo_referido))) {
            const referrer = await UsuarioDAL.findById(parseInt(codigo_referido));
            if (referrer) referido_por = referrer.id_usuario;
        }

        const id_usuario = await UsuarioDAL.create(nombre, correoNormalizado, correo_verificado, telefonoSeguro, telefonoHash, passwordHash, telefono_verificado, referido_por);
        
        if (referido_por) {
            await UsuarioBLL.procesarRecompensaReferido(referido_por);
        }
        
        return { id_usuario };
    }

    static async procesarRecompensaReferido(id_referidor) {
        const prisma = require('../Config/prisma'); 
        const referrer = await prisma.usuarios.findUnique({ where: { id_usuario: id_referidor } });
        if (!referrer) return;
        
        const newCount = (referrer.referidos_count || 0) + 1;
        const dataToUpdate = { referidos_count: newCount };
        
        if (newCount % 3 === 0) {
            let newDate = new Date();
            if (referrer.estado_suscripcion === 'activo' && referrer.id_plan === 2 && referrer.fecha_vencimiento_suscripcion) {
                newDate = new Date(referrer.fecha_vencimiento_suscripcion);
            }
            newDate.setDate(newDate.getDate() + 30);
            dataToUpdate.id_plan = 2;
            dataToUpdate.estado_suscripcion = 'activo';
            dataToUpdate.fecha_vencimiento_suscripcion = newDate;
        }
        
        await prisma.usuarios.update({ where: { id_usuario: id_referidor }, data: dataToUpdate });
    }

    static async login(identificador, password, rememberMe = false) {
        const idNormalizado = identificador.toLowerCase().trim();
        let target = idNormalizado;
        if (/^\+?[0-9]+$/.test(idNormalizado)) {
            const phone = idNormalizado.startsWith('+') ? idNormalizado : '+' + idNormalizado;
            target = generarFirmaHMAC(phone);
        }
        const usuario = await UsuarioDAL.findByIdentifier(target);
        if (!usuario) throw new Error('Usuario no encontrado o credenciales inválidas.');

        // Verificar si la cuenta está bloqueada temporalmente
        if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
            const minutosRestantes = Math.ceil((new Date(usuario.bloqueado_hasta) - new Date()) / 60000);
            throw new Error(`Cuenta bloqueada por seguridad. Intenta de nuevo en ${minutosRestantes} minuto(s).`);
        }

        const match = await bcrypt.compare(password, usuario.password_hash);
        if (!match) {
            // Incrementar intentos y verificar si llegó al límite
            const { intentos_fallidos } = await UsuarioDAL.incrementFailedAttempts(usuario.id_usuario);
            if (intentos_fallidos >= 5) {
                throw new Error('Demasiados intentos fallidos. Tu cuenta ha sido bloqueada por 15 minutos.');
            }
            throw new Error(`Contraseña incorrecta. Te quedan ${5 - intentos_fallidos} intento(s).`);
        }

        // Si el login es exitoso, reiniciar el contador de fallos
        await UsuarioDAL.resetFailedAttempts(usuario.id_usuario);

        const expiresIn = rememberMe ? '20d' : '2h';
        const token = jwt.sign(
            { id_usuario: usuario.id_usuario, correo: usuario.correo },
            JWT_SECRET,
            { expiresIn }
        );

        return { token, usuario };
    }

    static async obtenerPerfil(id_usuario) {
        const usuario = await UsuarioDAL.findById(id_usuario);
        if (!usuario) throw new Error('Usuario no encontrado');
        return { nombre: usuario.nombre, correo: usuario.correo, correo_verificado: usuario.correo_verificado || false, telefono: safeDecrypt(usuario.telefono), telefono_verificado: usuario.telefono_verificado || false, id_plan: usuario.id_plan, estado_suscripcion: usuario.estado_suscripcion, foto_url: usuario.foto_url, logros: await UsuarioDAL.getLogros(id_usuario) };
    }

    static async actualizarPerfil(id_usuario, nombre, telefono, foto_url, password_actual, nueva_password, eliminar_foto) {
        let hash = null;
        if (nueva_password && nueva_password.trim() !== '') {
            const hashActualDb = await UsuarioDAL.getPasswordHash(id_usuario);
            const match = await bcrypt.compare(password_actual || '', hashActualDb);
            if (!match) throw new Error('La contraseña actual es incorrecta.');
            hash = await bcrypt.hash(nueva_password, 10);
        }
        const telefonoSeguro = safeEncrypt(telefono);
        
        // --- Eliminar foto antigua de S3 si se subió una nueva o se solicitó su eliminación ---
        if (foto_url || eliminar_foto) {
            const oldUser = await UsuarioDAL.findById(id_usuario);
            if (oldUser && oldUser.foto_url && oldUser.foto_url.includes('amazonaws.com')) {
                try {
                    const urlObj = new URL(oldUser.foto_url);
                    const fileKey = decodeURIComponent(urlObj.pathname.substring(1));
                    const s3Client = new S3Client({ region: process.env.AWS_REGION });
                    await s3Client.send(new DeleteObjectCommand({
                        Bucket: process.env.AWS_BUCKET_NAME,
                        Key: fileKey
                    }));
                } catch (s3Error) {
                    console.error('⚠️ Error al eliminar foto de perfil antigua en S3:', s3Error.message);
                }
            }
        }

        let fotoUrlFinal = foto_url;
        if (eliminar_foto) fotoUrlFinal = null;

        await UsuarioDAL.updateProfile(id_usuario, nombre, undefined, fotoUrlFinal, hash);
    }

    static async verificarMetodoContactoExtra(id_usuario, metodo, valor, verificationToken, codigo) {
        const usuario = await UsuarioDAL.findById(id_usuario);
        if (!usuario) throw new Error('Usuario no encontrado.');

        if (metodo === 'email') {
            const correoNormalizado = valor.toLowerCase().trim();
            const exists = await UsuarioDAL.findByIdentifier(correoNormalizado);
            if (exists) throw new Error('El correo ya está en uso por otra cuenta.');

            const decoded = jwt.verify(verificationToken, JWT_SECRET);
            if (decoded.type !== 'email_verification' || decoded.correo !== correoNormalizado) throw new Error('Token inválido.');
            if (decoded.codeHash !== generarFirmaHMAC(codigo)) throw new Error('Código incorrecto.');

            await UsuarioDAL.updateContactMethod(id_usuario, { correo: correoNormalizado, correo_verificado: true });
        } else if (metodo === 'sms') {
            const telefonoHash = generarFirmaHMAC(valor.trim());
            const exists = await UsuarioDAL.findByIdentifier(telefonoHash);
            if (exists) throw new Error('El teléfono ya está en uso por otra cuenta.');

            const decoded = jwt.verify(verificationToken, JWT_SECRET);
            if (decoded.type !== 'sms_verification' || decoded.telefono !== valor.trim()) throw new Error('Token inválido.');
            if (decoded.codeHash !== generarFirmaHMAC(codigo)) throw new Error('Código incorrecto.');

            await UsuarioDAL.updateContactMethod(id_usuario, { telefono: safeEncrypt(valor.trim()), telefono_hash: telefonoHash, telefono_verificado: true });
        }
    }

    static async solicitarRecuperacion(correo) {
        const correoNormalizado = correo.toLowerCase().trim();
        let target = correoNormalizado;
        if (/^\+?[0-9]+$/.test(correoNormalizado)) target = generarFirmaHMAC(correoNormalizado.startsWith('+') ? correoNormalizado : '+' + correoNormalizado);
        const usuario = await UsuarioDAL.findByIdentifier(target);

        // Para prevenir enumeración de correos, no lanzamos error si el usuario no existe.
        // La lógica de rate-limiting solo se aplica si el usuario es encontrado.
        if (usuario) {
            if (usuario.recuperacion_bloqueado_hasta && new Date(usuario.recuperacion_bloqueado_hasta) > new Date()) {
                const minutosRestantes = Math.ceil((new Date(usuario.recuperacion_bloqueado_hasta) - new Date()) / 60000);
                throw new Error(`Has solicitado demasiadas recuperaciones. Intenta de nuevo en ${minutosRestantes} minuto(s).`);
            }

            let newAttempts = (usuario.recuperacion_intentos || 0);
            let newBlockUntil = usuario.recuperacion_bloqueado_hasta;

            // Si el último bloqueo ya pasó, reseteamos el contador
            if (newBlockUntil && new Date(newBlockUntil) < new Date()) {
                newAttempts = 0;
                newBlockUntil = null;
            }
            newAttempts++;

            if (newAttempts >= 3) {
                newBlockUntil = new Date(Date.now() + 15 * 60 * 1000); // Bloqueo por 15 minutos
            }
            await UsuarioDAL.updatePasswordRecoveryRateLimit(usuario.id_usuario, newAttempts, newBlockUntil);

            const token = crypto.randomBytes(20).toString('hex');
            await UsuarioDAL.setResetToken(correoNormalizado, token, new Date(Date.now() + 15 * 60 * 1000));
            return token;
        }

        return null; // No se encontró el usuario, no se genera token.
    }

    static async restablecerPassword(token, new_password) {
        const id_usuario = await UsuarioDAL.findByResetToken(token);
        if (!id_usuario) throw new Error('Token inválido o expirado. Solicita uno nuevo.');
        const hash = await bcrypt.hash(new_password, 10);
        await UsuarioDAL.updateProfile(id_usuario, undefined, undefined, undefined, hash); // Evita sobrescribir nombre/telefono
    }

    static async evaluarLogrosGastos(id_usuario) {
        const prisma = require('../Config/prisma');
        const countActivos = await prisma.transacciones.count({ where: { id_usuario_pagador: parseInt(id_usuario) } });
        const countHistorial = await prisma.transacciones_Historial.count({ where: { id_usuario_pagador: parseInt(id_usuario) } });
        const totalGastos = countActivos + countHistorial;
        
        const logrosActuales = await UsuarioDAL.getLogros(id_usuario);
        let nuevoLogro = null;
        
        const checkAndAdd = async (condicion, idLogro, nombreLogro) => {
            if (condicion && !logrosActuales.includes(idLogro)) {
                await UsuarioDAL.addLogro(id_usuario, idLogro);
                nuevoLogro = nombreLogro;
            }
        };
        
        await checkAndAdd(totalGastos >= 1, 'FIRST_EXPENSE', '🌱 Rompehielo (Primer Gasto)');
        await checkAndAdd(totalGastos >= 10, 'TEN_EXPENSES', '🚀 Gastador Frecuente (10 Gastos)');
        await checkAndAdd(totalGastos >= 50, '👑 FIFTY_EXPENSES', '👑 Maestro Financiero (50 Gastos)');
        return nuevoLogro; // Si se desbloqueó alguno, lo retornamos para avisar
    }

    static async guardarBanco(id_usuario, rut, banco, tipo_cuenta, numero_cuenta, correo) {
        if (!rut || !numero_cuenta) throw new Error('Debes proporcionar al menos tu RUT y un Número de Cuenta para recibir transferencias.');
        
        // Validación de formato de RUT Chileno usando Expresiones Regulares
        const rutRegex = /^[0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3}-[0-9Kk]{1}$/;
        if (!rutRegex.test(rut)) throw new Error('El formato del RUT es inválido. Ejemplos válidos: 12.345.678-9 o 12345678-k.');
        
        const rutEncriptado = safeEncrypt(rut);
        const cuentaEncriptada = safeEncrypt(numero_cuenta);
        await UsuarioDAL.upsertDatosBancarios(id_usuario, rutEncriptado, banco, tipo_cuenta, cuentaEncriptada, correo);
    }

    static async obtenerBanco(id_usuario) {
        const datos = await UsuarioDAL.getDatosBancarios(id_usuario);
        if (datos) {
            datos.rut = safeDecrypt(datos.rut);
            datos.numero_cuenta = safeDecrypt(datos.numero_cuenta);
        }
        return datos;
    }

    static async guardarSuscripcionPush(id_usuario, push_subscription) {
        await UsuarioDAL.updatePushSubscription(id_usuario, push_subscription);
    }

    static async activarGodMode(id_usuario) {
        await UsuarioDAL.enableGodMode(id_usuario);
    }
}

module.exports = UsuarioBLL;