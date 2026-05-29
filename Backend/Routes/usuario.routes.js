const express = require('express');
const router = express.Router();
const UsuarioBLL = require('../BLL/usuario.bll');
const { verificarToken } = require('../Middleware/auth.middleware');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { logError } = require('../Middleware/logger.util');

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
        const { correo, password } = req.body;
        const { token, usuario } = await UsuarioBLL.login(correo, password);
        res.json({ message: 'Login exitoso', token, id_usuario: usuario.id_usuario, nombre: usuario.nombre, estado_suscripcion: usuario.estado_suscripcion });
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
        
        const pool = require('../Config/db');
        await pool.query('UPDATE Usuarios SET reset_token = NULL, reset_token_expires = NULL WHERE reset_token = $1', [token]);
        res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
    } catch (error) { res.status(error.message.includes('Token') ? 400 : 500).json({ error: error.message }); }
});

router.post('/logout', verificarToken, async (req, res, next) => {
    try {
        const token = req.tokenActual;
        const expiracion = new Date(req.usuarioLogueado.exp * 1000);
        
        const pool = require('../Config/db');
        await pool.query('INSERT INTO Tokens_Revocados (token, fecha_expiracion) VALUES ($1, $2) ON CONFLICT DO NOTHING', [token, expiracion]);
        
        res.json({ message: 'Sesión cerrada en el servidor exitosamente.' });
    } catch (error) { next(error); }
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