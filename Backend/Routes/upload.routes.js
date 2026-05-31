const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { verificarToken } = require('../Middleware/auth.middleware');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

router.get('/presigned-url', verificarToken, async (req, res) => {
    try {
        const contentType = req.query.type || 'image/jpeg';
        const extension = contentType === 'application/pdf' ? 'pdf' : (contentType === 'image/png' ? 'png' : (contentType === 'image/webp' ? 'webp' : 'jpg'));
        const id_usuario = req.usuarioLogueado.id_usuario;
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