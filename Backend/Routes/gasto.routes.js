const express = require('express');
const router = express.Router();
const GastoBLL = require('../BLL/gasto.bll');
const { verificarToken } = require('../Middleware/auth.middleware');

router.get('/', verificarToken, async (req, res) => {
    try {
        res.json(await GastoBLL.obtenerGastos());
    } catch (error) { res.status(500).json({ error: 'Error interno del servidor' }); }
});

router.post('/', verificarToken, async (req, res) => {
    try {
        const { id_grupo, descripcion, categoria, monto, pagador, participantes, fecha, comprobante_url } = req.body;
        const data = await GastoBLL.crearGasto(id_grupo, descripcion, categoria || 'General', monto, pagador, participantes, fecha, comprobante_url, req.usuarioLogueado.id_usuario);
        res.status(201).json({ message: 'Gasto guardado exitosamente en PostgreSQL.', data });
    } catch (error) {
        res.status(error.message.includes('denegado') || error.message.includes('Faltan') ? 400 : 500).json({ error: error.message || 'Error al procesar la transacción' });
    }
});

router.delete('/:id', verificarToken, async (req, res) => {
    try {
        await GastoBLL.eliminarGasto(req.params.id, req.usuarioLogueado.id_usuario);
        
        // Emitir evento en tiempo real a todos los clientes conectados
        req.io.emit('gasto_eliminado', { id_transaccion: req.params.id });
        
        res.json({ message: 'Gasto eliminado exitosamente.' });
    } catch (error) {
        res.status(error.message.includes('encontrado') ? 404 : 403).json({ error: error.message });
    }
});

router.put('/:id', verificarToken, async (req, res) => {
    try {
        const { descripcion, categoria, monto } = req.body;
        await GastoBLL.editarGasto(req.params.id, descripcion, categoria || 'General', monto, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Gasto actualizado exitosamente.' });
    } catch (error) { res.status(403).json({ error: error.message }); }
});

module.exports = router;