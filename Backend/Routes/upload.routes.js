const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { verificarToken } = require('../Middleware/auth.middleware');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const prisma = require('../Config/prisma');

// NUEVO Endpoint GET: Obtener uso mensual de comprobantes
router.get('/quota', verificarToken, async (req, res) => {
    try {
        const id_usuario = req.usuarioLogueado.id_usuario;
        const usuario = await prisma.usuarios.findUnique({
            where: { id_usuario: parseInt(id_usuario) },
            select: { id_plan: true }
        });

        if (usuario.id_plan === 1) { // Plan Básico (Free)
            const now = new Date();
            const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1);
            const ultimoDiaMes = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

            const cond = { id_usuario_pagador: parseInt(id_usuario), comprobante_url: { not: null }, fecha_gasto: { gte: primerDiaMes, lte: ultimoDiaMes } };
            const [countActivas, countHistorial] = await Promise.all([
                prisma.transacciones.count({ where: cond }),
                prisma.transacciones_Historial.count({ where: cond })
            ]);

            res.json({ isFree: true, used: countActivas + countHistorial, limit: 5 });
        } else {
            res.json({ isFree: false }); // Premium no tiene límite
        }
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener cuota de comprobantes.' });
    }
});

router.get('/presigned-url', verificarToken, async (req, res) => {
    try {
        const contentType = req.query.type || 'image/jpeg';
        const extension = contentType === 'application/pdf' ? 'pdf' : (contentType === 'image/png' ? 'png' : (contentType === 'image/webp' ? 'webp' : 'jpg'));
        const id_usuario = req.usuarioLogueado.id_usuario;

        // --- 1. Control de Cuotas Mensuales (Free vs Premium) ---
        const usuario = await prisma.usuarios.findUnique({
            where: { id_usuario: parseInt(id_usuario) },
            select: { id_plan: true, estado_suscripcion: true }
        });

        if (usuario.id_plan === 1) { // Plan Básico (Free)
            const now = new Date();
            const primerDiaMes = new Date(now.getFullYear(), now.getMonth(), 1);
            const ultimoDiaMes = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

            // Contar comprobantes en transacciones Activas y Archivadas del mes actual
            const cond = { id_usuario_pagador: parseInt(id_usuario), comprobante_url: { not: null }, fecha_gasto: { gte: primerDiaMes, lte: ultimoDiaMes } };
            const [countActivas, countHistorial] = await Promise.all([
                prisma.transacciones.count({ where: cond }),
                prisma.transacciones_Historial.count({ where: cond })
            ]);

            if ((countActivas + countHistorial) >= 5) {
                return res.status(403).json({ error: 'Has alcanzado el límite de 5 comprobantes mensuales del Plan Básico. ¡Mejora a Premium para subir sin límites!' });
            }
        }

        const fileName = `${id_usuario}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`;

        const s3Client = new S3Client({ region: process.env.AWS_REGION });
        
        const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `archivos_adjuntos/${fileName}`,
            ContentType: contentType
        });
        
        const urlSegura = await getSignedUrl(s3Client, command, { expiresIn: 60 });

        res.json({
            url: urlSegura,
            fileKey: `archivos_adjuntos/${fileName}`,
            publicUrl: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/archivos_adjuntos/${fileName}`,
            message: 'Usa esta URL con el método PUT en el frontend para subir el archivo directo al Storage.'
        });
    } catch (error) { res.status(500).json({ error: 'No se pudo generar la URL de subida segura.' }); }
});

module.exports = router;