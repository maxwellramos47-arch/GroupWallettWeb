const express = require('express');
const router = express.Router();
const GrupoBLL = require('../BLL/grupo.bll');
const { verificarToken } = require('../Middleware/auth.middleware');

router.post('/', verificarToken, async (req, res) => {
    try {
        const id_grupo = await GrupoBLL.crearGrupo(req.body.nombre_grupo, req.usuarioLogueado.id_usuario);
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
        await GrupoBLL.editarGrupo(req.params.id, req.usuarioLogueado.id_usuario, req.body.nombre_grupo);
        res.json({ message: 'Nombre del grupo actualizado exitosamente.' });
    } catch (error) {
        res.status(error.message.includes('denegado') ? 403 : 400).json({ error: error.message });
    }
});

router.post('/:id/invitacion', verificarToken, async (req, res) => {
    try {
        const inviteToken = await GrupoBLL.generarInvitacion(req.params.id, req.usuarioLogueado.id_usuario);
        const inviteUrl = `${req.protocol}://${req.get('host')}/join.html?token=${inviteToken}`;
        res.json({ enlace: inviteUrl });
    } catch (error) {
        res.status(error.message.includes('administradores') ? 403 : 500).json({ error: error.message });
    }
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

router.delete('/:id/miembros/:idUsuario', verificarToken, async (req, res) => {
    try {
        await GrupoBLL.expulsarMiembro(req.params.id, req.params.idUsuario, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Miembro expulsado exitosamente del grupo.' });
    } catch (error) {
        res.status(403).json({ error: error.message });
    }
});

module.exports = router;