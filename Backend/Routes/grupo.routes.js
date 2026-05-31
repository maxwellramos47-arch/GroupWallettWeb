const express = require('express');
const router = express.Router();
const GrupoBLL = require('../BLL/grupo.bll');
const { verificarToken } = require('../Middleware/auth.middleware');
const nodemailer = require('nodemailer');
const prisma = require('../Config/prisma');
const EmailTemplates = require('./emailTemplates');
const { z } = require('zod');
const QRCode = require('qrcode');

// --- Esquemas de Validación Zod ---
const grupoSchema = z.object({
    nombre_grupo: z.string().min(1, "El nombre del grupo es obligatorio").max(100, "El nombre es demasiado largo")
});

router.post('/', verificarToken, async (req, res) => {
    try {
        const validacion = grupoSchema.safeParse(req.body);
        if (!validacion.success) return res.status(400).json({ error: validacion.error.errors[0].message });
        
        const id_grupo = await GrupoBLL.crearGrupo(validacion.data.nombre_grupo, req.usuarioLogueado.id_usuario);
        res.status(201).json({ message: 'Grupo creado con éxito', id_grupo });
    } catch (error) {
        res.status(error.message.includes('límite') ? 403 : 500).json({ error: error.message || 'Error al crear el grupo' });
    }
});

router.get('/', verificarToken, async (req, res) => {
    try {
        res.json(await GrupoBLL.obtenerGrupos(req.usuarioLogueado.id_usuario));
    } catch (error) { res.status(500).json({ error: 'Error al obtener los grupos' }); }
});

router.get('/:id/miembros', verificarToken, async (req, res) => {
    try {
        res.json(await GrupoBLL.obtenerMiembros(req.params.id));
    } catch (error) { res.status(500).json({ error: 'Error al obtener los miembros' }); }
});

router.put('/:id', verificarToken, async (req, res) => {
    try {
        const validacion = grupoSchema.safeParse(req.body);
        if (!validacion.success) return res.status(400).json({ error: validacion.error.errors[0].message });
        
        await GrupoBLL.editarGrupo(req.params.id, req.usuarioLogueado.id_usuario, validacion.data.nombre_grupo);
        res.json({ message: 'Nombre del grupo actualizado exitosamente.' });
    } catch (error) {
        res.status(error.message.includes('denegado') ? 403 : 400).json({ error: error.message });
    }
});

// NUEVO Endpoint: Generar QR y enlace mágico de invitación (Mobile-First)
router.get('/:id/codigo-qr', verificarToken, async (req, res) => {
    try {
        const inviteToken = await GrupoBLL.generarInvitacion(req.params.id, req.usuarioLogueado.id_usuario);
        const inviteUrl = `${req.protocol}://${req.get('host')}/join.html?token=${inviteToken}`;
        
        // Generar QR en formato Base64 para consumo nativo en Frontend Mobile
        const qrBase64 = await QRCode.toDataURL(inviteUrl, {
            color: { dark: '#0F172A', light: '#FFFFFF' }, width: 300, margin: 2
        });
        
        res.json({ enlace: inviteUrl, qr: qrBase64 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/invitacion', verificarToken, async (req, res) => {
    try {
        const inviteToken = await GrupoBLL.generarInvitacion(req.params.id, req.usuarioLogueado.id_usuario);
        const inviteUrl = `${req.protocol}://${req.get('host')}/join.html?token=${inviteToken}`;
        
        // --- Enviar correo de invitación (Background Task) ---
        const { correo } = req.body || {};
        if (correo) {
            try {
                const grupo = await prisma.grupos.findUnique({ where: { id_grupo: parseInt(req.params.id) } });
                const usuario = await prisma.usuarios.findUnique({ where: { id_usuario: parseInt(req.usuarioLogueado.id_usuario) } });
                
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST || 'smtp.gmail.com',
                    port: process.env.SMTP_PORT || 587,
                    secure: false,
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                });
                const mailOptions = {
                    from: `"GroupWallet" <${process.env.SMTP_USER}>`,
                    to: correo,
                    subject: `Invitación para unirte a "${grupo.nombre_grupo}"`,
                    html: EmailTemplates.invitacionGrupo(usuario.nombre, grupo.nombre_grupo, inviteUrl)
                };
                transporter.sendMail(mailOptions).catch(err => console.error('Error enviando invitación por correo:', err));
            } catch (err) { console.error('Error configurando correo de invitación:', err); }
        }

        res.json({ enlace: inviteUrl });
    } catch (error) {
        res.status(error.message.includes('administradores') ? 403 : 500).json({ error: error.message });
    }
});

// NUEVO Endpoint: Invitar enviando notificación vía Nodemailer / Twilio
router.post('/:id/invitar', verificarToken, async (req, res) => {
    try {
        const { correo, telefono } = req.body;
        const hostUrl = `${req.protocol}://${req.get('host')}`;
        await GrupoBLL.enviarInvitacionDirecta(req.params.id, req.usuarioLogueado.id_usuario, correo, telefono, hostUrl);
        res.json({ message: 'Invitación procesada y enviada a los destinatarios con éxito.' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/unirse', verificarToken, async (req, res) => {
    try {
        const id_grupo = await GrupoBLL.unirseGrupo(req.body.token_invitacion, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Te has unido al grupo exitosamente.', id_grupo });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.get('/:id/liquidar', verificarToken, async (req, res) => {
    try {
        const transferencias = await GrupoBLL.liquidarDeudas(req.params.id, req.usuarioLogueado.id_usuario);
        res.json(transferencias);
    } catch (error) {
        res.status(403).json({ error: error.message });
    }
});

router.post('/:id/liquidar/whatsapp', verificarToken, async (req, res) => {
    try {
        const { transferencias } = req.body;
        const enviados = await GrupoBLL.enviarResumenWhatsApp(req.params.id, req.usuarioLogueado.id_usuario, transferencias);
        res.json({ message: `Resumen enviado a ${enviados} miembro(s) por WhatsApp automatizado.` });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/:id/liquidar/pagar', verificarToken, async (req, res) => {
    try {
        const { id_deudor, id_acreedor, monto } = req.body;
        await GrupoBLL.registrarPagoTransferencia(req.params.id, id_deudor, id_acreedor, monto, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Pago de liquidación registrado exitosamente.' });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.delete('/:id/miembros/:idUsuario', verificarToken, async (req, res) => {
    try {
        await GrupoBLL.expulsarMiembro(req.params.id, req.params.idUsuario, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Miembro expulsado exitosamente del grupo.' });
    } catch (error) {
        res.status(403).json({ error: error.message });
    }
});

module.exports = router;