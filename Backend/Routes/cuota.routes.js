const express = require('express');
const router = express.Router();
const GastoBLL = require('../BLL/gasto.bll');
const { verificarToken } = require('../Middleware/auth.middleware');

router.put('/pagar', verificarToken, async (req, res) => {
    try {
        const { id_transaccion, id_usuario } = req.body;
        const archivado = await GastoBLL.pagarCuota(id_transaccion, id_usuario, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Cuota marcada como pagada exitosamente.', archivado });
    } catch (error) { res.status(403).json({ error: error.message }); }
});

router.post('/pago-inapp', verificarToken, async (req, res) => {
    try {
        const { id_transaccion } = req.body;
        const resultado = await GastoBLL.pagarCuotaInApp(id_transaccion, req.usuarioLogueado.id_usuario, req.usuarioLogueado.id_usuario);
        res.json({ message: 'Pago procesado exitosamente mediante GroupWallet.', detalle: resultado });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

module.exports = router;