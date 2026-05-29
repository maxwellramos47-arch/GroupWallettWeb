const express = require('express');
const router = express.Router();
const UsuarioBLL = require('../BLL/usuario.bll');
const { verificarToken } = require('../Middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const prisma = require('../Config/prisma');
const { logError } = require('../Middleware/logger.util');
const UAParser = require('ua-parser-js');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Demasiados intentos de inicio de sesión desde esta IP. Bloqueo de red activado por 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/registro', async (req, res) => {
    try {
        const { nombre, correo, password } = req.body;
        const id = await UsuarioBLL.registrar(nombre, correo, password);
        res.status(201).json({ message: 'Usuario registrado con seguridad', id });
    } catch (error) { 
        logError('Registro de Usuario POST /registro', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'Este correo electrónico ya está registrado. Intenta iniciar sesión.' });
        }
        res.status(500).json({ error: 'Error interno al registrar usuario: ' + error.message }); 
    }
});

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { correo, password, rememberMe } = req.body;
        const { token, usuario } = await UsuarioBLL.login(correo, password, rememberMe); // Pasamos el parámetro a la BLL
        
        const cookieMaxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000; // 30 días o 2 horas

        res.cookie('usuarioToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'Strict',
            maxAge: cookieMaxAge
        });

        // --- Capturar y Guardar Dispositivo e IP ---
        try {
            const parser = new UAParser(req.headers['user-agent']);
            const result = parser.getResult();
            const browser = result.browser.name ? `${result.browser.name}` : 'Navegador desconocido';
            const os = result.os.name ? `${result.os.name}` : 'SO desconocido';
            
            const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'IP desconocida';

            await prisma.sesiones_Activas.create({
                data: {
                    id_usuario: usuario.id_usuario,
                    token: token,
                    dispositivo: `${browser} en ${os}`,
                    ip: ip
                }
            });
        } catch (err) { console.error('Error al registrar la sesión:', err); }

        res.json({ message: 'Login exitoso', id_usuario: usuario.id_usuario, nombre: usuario.nombre, estado_suscripcion: usuario.estado_suscripcion });
    } catch (error) {
        const status = error.message.includes('encontrado') || error.message.includes('incorrecta') || error.message.includes('bloqueada') || error.message.includes('intento') ? 401 : 500;
        res.status(status).json({ error: error.message || 'Error en el servidor al intentar iniciar sesión' });
    }
});

router.get('/perfil', verificarToken, async (req, res) => {
    try {
        const perfil = await UsuarioBLL.obtenerPerfil(req.usuarioLogueado.id_usuario);
        res.json(perfil);
    } catch (error) { res.status(500).json({ error: 'Error al obtener el perfil' }); }
});

router.put('/perfil', verificarToken, async (req, res) => {
    try {
        const { nombre, telefono, foto_url, password } = req.body;
        await UsuarioBLL.actualizarPerfil(req.usuarioLogueado.id_usuario, nombre, telefono, foto_url, password);
        res.json({ message: 'Perfil actualizado exitosamente' });
    } catch (error) { res.status(500).json({ error: 'Error al actualizar el perfil' }); }
});

router.post('/recuperar-password', async (req, res) => {
    try {
        const token = await UsuarioBLL.solicitarRecuperacion(req.body.correo);
        
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
            to: req.body.correo,
            subject: 'Recuperación de Contraseña - GroupWallet',
            html: `<h2>Recuperación de Cuenta</h2><p>Has solicitado restablecer tu contraseña en GroupWallet.</p><p>Tu token de seguridad es: <strong style="font-size: 1.2rem; color: #2ecc71;">${token}</strong></p><p>Cópialo y pégalo en la aplicación para crear tu nueva contraseña.</p><p><em>Si no solicitaste esto, puedes ignorar este correo.</em></p>`
        };
        await transporter.sendMail(mailOptions);
        
        res.json({ message: 'Se ha enviado un correo con las instrucciones.' });
    } catch (error) {
        res.status(error.message.includes('no encontrado') ? 404 : 500).json({ error: error.message });
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
        
        await prisma.tokens_Revocados.upsert({
            where: { token },
            update: {},
            create: { token, fecha_expiracion: expiracion }
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
        await prisma.tokens_Revocados.upsert({
            where: { token: sesion.token },
            update: {},
            create: { token: sesion.token, fecha_expiracion: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
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

module.exports = router;