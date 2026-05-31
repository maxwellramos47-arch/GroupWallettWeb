const express = require('express');
const router = express.Router();
const UsuarioBLL = require('../BLL/usuario.bll');
const { verificarToken } = require('../Middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const prisma = require('../Config/prisma');
const { logError } = require('../Middleware/logger.util');
const UAParser = require('ua-parser-js');
const EmailTemplates = require('./emailTemplates');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../Middleware/security.util');
const { z } = require('zod');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Demasiados intentos de inicio de sesión desde esta IP. Bloqueo de red activado por 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.get('/captcha', (req, res) => {
    // Generar un CAPTCHA Matemático protegido por el servidor
    const num1 = Math.floor(Math.random() * 10) + 1;
    const num2 = Math.floor(Math.random() * 10) + 1;
    const answer = num1 + num2;
    
    // Firmamos la respuesta correcta en un token que caduca en 10 minutos
    const token = jwt.sign({ answer, type: 'captcha' }, JWT_SECRET, { expiresIn: '10m' });
    res.json({ question: `¿Cuánto es ${num1} + ${num2}?`, token });
});

const smsLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 3,
    message: { error: 'Has solicitado demasiados códigos. Intenta de nuevo en 10 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/enviar-codigo-registro', smsLimiter, async (req, res) => {
    try {
        const { telefono, oldToken } = req.body;
        if (!telefono) return res.status(400).json({ error: 'Falta el número de teléfono.' });

        // Invalidar el token anterior si existe
        if (oldToken) {
            try {
                const decoded = jwt.decode(oldToken);
                if (decoded && decoded.exp) {
                    await prisma.tokens_Revocados.createMany({
                        data: [{ token: oldToken, fecha_expiracion: new Date(decoded.exp * 1000) }],
                        skipDuplicates: true
                    });
                }
            } catch (e) { /* Ignorar errores si el token viejo estaba corrupto */ }
        }
        
        const { token } = await UsuarioBLL.generarTokenVerificacion(telefono);
        res.json({ message: 'Código SMS enviado exitosamente.', verificationToken: token });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 1. Definición del Esquema Zod para validar el Registro
const registroSchema = z.object({
    nombre: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100, "El nombre es demasiado largo"),
    correo: z.string().email("El formato del correo electrónico es inválido"),
    telefono: z.string().nullable().optional(),
    password: z.string()
        .min(8, "La contraseña debe tener mínimo 8 caracteres")
        .regex(/[A-Z]/, "La contraseña debe contener al menos una letra mayúscula")
        .regex(/[0-9]/, "La contraseña debe contener al menos un número"),
    captchaAnswer: z.string().min(1, "Debes resolver el CAPTCHA"),
    captchaToken: z.string().min(1, "Falta el token del CAPTCHA"),
    verificationToken: z.string().nullable().optional(),
    codigoSms: z.string().nullable().optional()
});

router.post('/registro', async (req, res) => {
    try {
        // 2. Ejecutar la validación de Zod contra el JSON entrante
        const validacion = registroSchema.safeParse(req.body);
        if (!validacion.success) {
            // Si falla, retornamos el primer error amigable que encuentre Zod
            return res.status(400).json({ error: validacion.error.errors[0].message });
        }
        
        // 3. Usar los datos ya validados y limpios (sanitizados)
        const { nombre, correo, telefono, password, captchaAnswer, captchaToken, verificationToken, codigoSms } = validacion.data;
        
        // --- Validación Estricta de CAPTCHA en Backend ---
        if (!captchaToken || !captchaAnswer) return res.status(400).json({ error: 'Falta la verificación de seguridad (CAPTCHA).' });
        try {
            const decoded = jwt.verify(captchaToken, JWT_SECRET);
            if (decoded.type !== 'captcha' || decoded.answer !== parseInt(captchaAnswer)) {
                return res.status(400).json({ error: 'Respuesta de seguridad (CAPTCHA) incorrecta.' });
            }
        } catch (err) { return res.status(400).json({ error: 'El CAPTCHA expiró o es inválido. Por favor, recarga la página.' }); }

        // --- Validación Estricta de Código Invalidado ---
        if (verificationToken) {
            const isRevoked = await prisma.tokens_Revocados.findUnique({ where: { token: verificationToken } });
            if (isRevoked) {
                return res.status(400).json({ error: 'Este código ha sido invalidado porque solicitaste uno nuevo.' });
            }
        }

        const { id_usuario } = await UsuarioBLL.registrar(nombre, correo, telefono, password, verificationToken, codigoSms);
        
        // --- Quemar el token usado (Single-Use Token) ---
        if (verificationToken) {
            try {
                const dec = jwt.decode(verificationToken);
                if (dec && dec.exp) {
                    await prisma.tokens_Revocados.createMany({
                        data: [{ token: verificationToken, fecha_expiracion: new Date(dec.exp * 1000) }],
                        skipDuplicates: true
                    });
                }
            } catch (err) {}
        }

        // --- Enviar correo de bienvenida (Background Task) ---
        try {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: process.env.SMTP_PORT || 587,
                secure: false,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });

            const mailOptions = {
                from: `"GroupWallet" <${process.env.SMTP_USER}>`,
                to: correo,
                subject: '¡Bienvenido a GroupWallet!',
                html: EmailTemplates.bienvenida(nombre)
            };
            
            transporter.sendMail(mailOptions).catch(err => console.error('Error enviando correo de bienvenida:', err));
        } catch (mailError) { console.error('Error configurando correo de bienvenida:', mailError); }
        
        res.status(201).json({ message: 'Usuario registrado con seguridad', id_usuario });
    } catch (error) { 
        logError('Registro de Usuario POST /registro', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Este correo electrónico ya está registrado. Intenta iniciar sesión.' });
        }
        res.status(500).json({ error: 'Error interno al registrar usuario: ' + error.message }); 
    }
});

// --- Definición del Esquema Zod para validar el Login ---
const loginSchema = z.object({
    correo: z.string().email("El formato del correo electrónico es inválido"),
    password: z.string().min(1, "La contraseña es obligatoria"),
    rememberMe: z.boolean().optional().default(false)
});

router.post('/login', loginLimiter, async (req, res) => {
    try {
        // --- Validación estricta con Zod ---
        const validacion = loginSchema.safeParse(req.body);
        if (!validacion.success) {
            return res.status(400).json({ error: validacion.error.errors[0].message });
        }
        
        const { correo, password, rememberMe } = validacion.data;
        const { token, usuario } = await UsuarioBLL.login(correo, password, rememberMe); // Pasamos el parámetro a la BLL
        
        const cookieMaxAge = rememberMe ? 20 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000; // 20 días o 2 horas

        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie('usuarioToken', token, {
            httpOnly: true,
            secure: isSecure, // Detecta dinámicamente HTTP local o HTTPS en Render
            sameSite: 'Lax', // Permite conservar la sesión al regresar de sitios externos o marcadores web
            maxAge: cookieMaxAge
        });

        // --- Capturar y Guardar Dispositivo e IP ---
        const parser = new UAParser(req.headers['user-agent']);
        const result = parser.getResult();
        const browser = result.browser.name ? `${result.browser.name}` : 'Navegador desconocido';
        const os = result.os.name ? `${result.os.name}` : 'SO desconocido';
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'IP desconocida';

        // Eliminamos el try/catch para FORZAR que el inicio de sesión falle si la DB falla (Source of Truth)
        await prisma.sesiones_Activas.create({
            data: {
                id_usuario: usuario.id_usuario,
                token: token,
                dispositivo: `${browser} en ${os}`.substring(0, 255),
                ip: ip.substring(0, 50)
            }
        });

        res.json({ message: 'Login exitoso', id_usuario: usuario.id_usuario, nombre: usuario.nombre, estado_suscripcion: usuario.estado_suscripcion });
    } catch (error) {
        const status = error.message.includes('encontrado') || error.message.includes('incorrecta') || error.message.includes('bloqueada') || error.message.includes('intento') ? 401 : 500;
        res.status(status).json({ error: error.message || 'Error en el servidor al intentar iniciar sesión' });
    }
});

// --- Validar Sesión Activa (Para redirecciones de Frontend) ---
router.get('/validate-session', verificarToken, (req, res) => {
    res.json({ valid: true, id_usuario: req.usuarioLogueado.id_usuario });
});

router.get('/perfil', verificarToken, async (req, res) => {
    try {
        const perfil = await UsuarioBLL.obtenerPerfil(req.usuarioLogueado.id_usuario);
        res.json(perfil);
    } catch (error) { res.status(500).json({ error: 'Error al obtener el perfil' }); }
});

router.put('/perfil', verificarToken, async (req, res) => {
    try {
        const { nombre, telefono, foto_url, password_actual, nueva_password, eliminar_foto } = req.body;
        await UsuarioBLL.actualizarPerfil(req.usuarioLogueado.id_usuario, nombre, telefono, foto_url, password_actual, nueva_password, eliminar_foto);
        res.json({ message: 'Perfil actualizado exitosamente' });
    } catch (error) { 
        res.status(error.message.includes('incorrecta') ? 401 : 500).json({ error: error.message || 'Error al actualizar el perfil' }); 
    }
});

router.post('/recuperar-password', async (req, res) => {
    try {
        const token = await UsuarioBLL.solicitarRecuperacion(req.body.correo);

        // Solo enviamos el correo si se generó un token (usuario existe y no está bloqueado)
        if (token) {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: process.env.SMTP_PORT || 587,
                secure: false,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            });

            const clientUrl = req.headers.origin || process.env.FRONTEND_URL || `${req.secure ? 'https://' : 'http://'}${req.headers.host}`;
            const recoveryLink = `${clientUrl}/login.html?reset_token=${token}`;

            const mailOptions = {
                from: `"GroupWallet" <${process.env.SMTP_USER}>`,
                to: req.body.correo,
                subject: 'Restablecer Contraseña - GroupWallet',
                html: EmailTemplates.recuperacionPassword(recoveryLink)
            };
            // Enviar en segundo plano para no hacer esperar al usuario
            transporter.sendMail(mailOptions).catch(err => console.error('Error enviando correo de recuperación:', err));
        }

        // Siempre devolver un mensaje genérico para evitar enumeración de correos
        res.json({ message: 'Si tu correo está registrado, recibirás un enlace de recuperación en breve.' });
    } catch (error) {
        if (error.message.includes('demasiadas recuperaciones')) {
            return res.status(429).json({ error: error.message });
        }
        console.error('Error al solicitar recuperación:', error);
        // Para cualquier otro error, también devolvemos un mensaje genérico por seguridad
        res.json({ message: 'Si tu correo está registrado, recibirás un enlace de recuperación en breve.' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { token, new_password } = req.body;
        await UsuarioBLL.restablecerPassword(token, new_password);
        
        await prisma.usuarios.updateMany({
            where: { reset_token: token },
            data: { reset_token: null, reset_token_expires: null }
        });
        res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
    } catch (error) { res.status(error.message.includes('Token') ? 400 : 500).json({ error: error.message }); }
});

router.post('/logout', verificarToken, async (req, res, next) => {
    try {
        const token = req.tokenActual;
        const expiracion = new Date(req.usuarioLogueado.exp * 1000);
        
        await prisma.tokens_Revocados.createMany({
            data: [{ token, fecha_expiracion: expiracion }],
            skipDuplicates: true
        });
        
        // Limpiar la sesión actual de la lista de dispositivos
        await prisma.sesiones_Activas.deleteMany({ where: { token } });

        res.clearCookie('usuarioToken');
        res.json({ message: 'Sesión cerrada en el servidor exitosamente.' });
    } catch (error) { next(error); }
});

// --- Cerrar Sesión en Todos los Dispositivos ---
router.post('/logout-all', verificarToken, async (req, res, next) => {
    try {
        await prisma.usuarios.update({
            where: { id_usuario: parseInt(req.usuarioLogueado.id_usuario) },
            data: { fecha_revocacion_sesiones: new Date() } // Cualquier JWT anterior a "ahora" morirá
        });
        
        // Limpiar absolutamente todas las sesiones de la tabla
        await prisma.sesiones_Activas.deleteMany({
            where: { id_usuario: parseInt(req.usuarioLogueado.id_usuario) }
        });

        res.clearCookie('usuarioToken');
        res.json({ message: 'Se ha cerrado sesión en todos los dispositivos exitosamente.' });
    } catch (error) { next(error); }
});

// --- Obtener Lista de Sesiones Activas ---
router.get('/sesiones', verificarToken, async (req, res) => {
    try {
        const sesiones = await prisma.sesiones_Activas.findMany({
            where: { id_usuario: parseInt(req.usuarioLogueado.id_usuario) },
            orderBy: { ultimo_acceso: 'desc' }
        });
        
        // Mapear el resultado para identificar cuál es la sesión en uso actualmente
        const tokenActual = req.tokenActual;
        const resultado = sesiones.map(s => ({
            id_sesion: s.id_sesion,
            dispositivo: s.dispositivo,
            ip: s.ip,
            ultimo_acceso: s.ultimo_acceso,
            es_actual: s.token === tokenActual
        }));

        res.json(resultado);
    } catch (error) {
        console.error('Error al obtener sesiones:', error);
        res.status(500).json({ error: 'Error al obtener los dispositivos conectados.' });
    }
});

// --- Desconectar un Dispositivo Específico ---
router.delete('/sesiones/:id_sesion', verificarToken, async (req, res) => {
    try {
        const id_sesion = parseInt(req.params.id_sesion);
        const id_usuario = parseInt(req.usuarioLogueado.id_usuario);

        const sesion = await prisma.sesiones_Activas.findUnique({ where: { id_sesion } });

        if (!sesion || sesion.id_usuario !== id_usuario) {
            return res.status(403).json({ error: 'No tienes permiso para cerrar esta sesión o no existe.' });
        }

        // Enviar el token a la lista negra (tokens revocados) para que Node.js lo rechace si intenta hacer requests
        await prisma.tokens_Revocados.createMany({
            data: [{ token: sesion.token, fecha_expiracion: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) }],
            skipDuplicates: true
        });

        await prisma.sesiones_Activas.delete({ where: { id_sesion } });
        res.json({ message: 'El dispositivo ha sido desconectado exitosamente.' });
    } catch (error) {
        console.error('Error al cerrar sesión específica:', error);
        res.status(500).json({ error: 'Error interno al intentar desconectar el dispositivo.' });
    }
});

// --- Rutas de Datos Bancarios ---
router.post('/banco', verificarToken, async (req, res) => {
    try {
        const { rut, banco, tipo_cuenta, numero_cuenta, correo } = req.body;
        await UsuarioBLL.guardarBanco(req.usuarioLogueado.id_usuario, rut, banco, tipo_cuenta, numero_cuenta, correo);
        res.json({ message: 'Datos bancarios guardados exitosamente.' });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

router.get('/:id/banco', verificarToken, async (req, res) => {
    try {
        const datos = await UsuarioBLL.obtenerBanco(req.params.id);
        if (!datos) return res.status(404).json({ error: 'El usuario no ha registrado sus datos bancarios.' });
        res.json(datos);
    } catch (error) { res.status(500).json({ error: 'Error al obtener datos bancarios.' }); }
});

// --- Rutas para Notificaciones Push ---
router.get('/vapidPublicKey', verificarToken, (req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.post('/suscripcion-push', verificarToken, async (req, res) => {
    try {
        const subscription = JSON.stringify(req.body);
        await UsuarioBLL.guardarSuscripcionPush(req.usuarioLogueado.id_usuario, subscription);
        res.json({ message: 'Suscripción Push registrada exitosamente.' });
    } catch (error) { res.status(500).json({ error: 'Error al registrar suscripción Push.' }); }
});

// --- God Mode Temporal ---
router.post('/godmode', verificarToken, async (req, res) => {
    try {
        await UsuarioBLL.activarGodMode(req.usuarioLogueado.id_usuario);
        res.json({ message: 'God Mode activado exitosamente' });
    } catch (error) { res.status(500).json({ error: 'Error al activar God Mode' }); }
});

// --- Endpoint: Historial de Pagos Recibidos In-App ---
router.get('/pagos-recibidos', verificarToken, async (req, res) => {
    try {
        const pagos = await prisma.pagos_InApp.findMany({
            where: { id_usuario_receptor: parseInt(req.usuarioLogueado.id_usuario) },
            include: { pagador: { select: { nombre: true } } },
            orderBy: { fecha_pago: 'desc' }
        });
        res.json(pagos);
    } catch (error) { res.status(500).json({ error: 'Error al obtener pagos recibidos' }); }
});

module.exports = router;