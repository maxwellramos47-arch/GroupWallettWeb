const express = require('express');
const router = express.Router();
const GastoBLL = require('../BLL/gasto.bll');
const { verificarToken } = require('../Middleware/auth.middleware');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const prisma = require('../Config/prisma');

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

router.put('/pagar', verificarToken, async (req, res) => {
    try {
        const { id_transaccion, id_usuario } = req.body;
        const archivado = await GastoBLL.pagarCuota(id_transaccion, id_usuario, req.usuarioLogueado.id_usuario);
        
        // Emitir evento en tiempo real a todos los clientes conectados
        req.io.emit('cuota_pagada', { 
            id_transaccion: parseInt(id_transaccion), 
            id_usuario: parseInt(id_usuario), 
            archivado 
        });

        res.json({ message: 'Cuota marcada como pagada exitosamente.', archivado });
    } catch (error) { res.status(403).json({ error: error.message }); }
});

router.post('/checkout', verificarToken, async (req, res) => {
    try {
        const { id_transaccion } = req.body;
        const id_usuario = req.usuarioLogueado.id_usuario;

        // Obtener la transacción original y saber entre cuántos se dividió
        const gasto = await prisma.transacciones.findUnique({
            where: { id_transaccion: parseInt(id_transaccion) },
            include: { 
                _count: { select: { participantes: true } }
            }
        });

        if (!gasto) return res.status(404).json({ error: 'Gasto no encontrado.' });

        // Cálculo estricto matemático
        const montoCuotaBase = parseFloat(gasto.monto) / gasto._count.participantes;
        const comision = montoCuotaBase * 0.0089; // Comisión in-app del 0.89%
        const montoFinal = montoCuotaBase + comision;

        const preference = new Preference(mpClient);
        const result = await preference.create({
            body: {
                items: [{
                    title: `Cuota: ${gasto.descripcion}`,
                    description: `Cubre tu parte del gasto. Incluye comisión (0.89%)`,
                    unit_price: Math.round(montoFinal), // MercadoPago Chile (CLP) no usa decimales
                    quantity: 1,
                    currency_id: 'CLP'
                }],
                back_urls: {
                    success: `${req.protocol}://${req.get('host')}/dashboard.html?pago_cuota=success&id_t=${id_transaccion}`,
                    failure: `${req.protocol}://${req.get('host')}/dashboard.html?pago_cuota=canceled`,
                    pending: `${req.protocol}://${req.get('host')}/dashboard.html?pago_cuota=canceled`
                },
                auto_return: 'approved',
                external_reference: `${id_usuario}-${id_transaccion}` // Vital para identificarlo en el Webhook
            }
        });

        res.json({ url: result.init_point });
    } catch (error) { console.error('Error MercadoPago Checkout:', error); res.status(500).json({ error: 'Error al generar link de pago.' }); }
});

router.post('/confirmar-checkout', verificarToken, async (req, res) => {
    try {
        const { payment_id, id_transaccion } = req.body;
        const id_usuario = req.usuarioLogueado.id_usuario;

        const payment = new Payment(mpClient);
        const payInfo = await payment.get({ id: payment_id });
        if (payInfo.status === 'approved') {
            const transaccion = await prisma.transacciones.findUnique({ where: { id_transaccion: parseInt(id_transaccion) } });
            if (!transaccion) return res.status(404).json({ error: 'Transacción original no encontrada.' });

            const resultado = await GastoBLL.pagarCuotaInApp(parseInt(id_transaccion), parseInt(id_usuario), transaccion.id_usuario_pagador);
            
            req.io.emit('cuota_pagada', { id_transaccion: parseInt(id_transaccion), id_usuario: parseInt(id_usuario), archivado: resultado?.archivado || false });
            res.json({ message: 'Pago procesado exitosamente. Tu deuda ha sido saldada.' });
        } else { res.status(400).json({ error: 'El pago no se completó en MercadoPago.' }); }
    } catch (error) { res.status(500).json({ error: 'Error al verificar el pago.' }); }
});

router.post('/notificar-pago', verificarToken, async (req, res) => {
    try {
        const { id_transaccion } = req.body;
        const id_deudor = req.usuarioLogueado.id_usuario;
        const resultado = await GastoBLL.notificarPagoManualPorWhatsApp(id_transaccion, id_deudor);
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/notificar-pago-email', verificarToken, async (req, res) => {
    try {
        const { id_transaccion } = req.body;
        const id_deudor = req.usuarioLogueado.id_usuario;
        const resultado = await GastoBLL.notificarPagoManualPorEmail(id_transaccion, id_deudor);
        res.json(resultado);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

module.exports = router;