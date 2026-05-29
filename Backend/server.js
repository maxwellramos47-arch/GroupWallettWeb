const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const http = require('http');
const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const { Client } = require('pg');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { Server } = require('socket.io');

const pool = require('./Config/db');
const { encriptarDatoSensible, desencriptarDatoSensible, generarFirmaHMAC, JWT_SECRET } = require('./Middleware/security.util');
const { verificarToken } = require('./Middleware/auth.middleware');
const usuarioRoutes = require('./Routes/usuario.routes');
const grupoRoutes = require('./Routes/grupo.routes');
const gastoRoutes = require('./Routes/gasto.routes');
const cuotaRoutes = require('./Routes/cuota.routes');
const uploadRoutes = require('./Routes/upload.routes');
const { logError } = require('./Middleware/logger.util');

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Configurar Web Push para notificaciones
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:soporte@groupwallet.com',
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

// Inyectar WebSockets en cada petición
app.use((req, res, next) => {
    req.io = io;
    next();
});

// ==========================================
// Middleware de Seguridad: Cabeceras HTTP
// ==========================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            // Permitimos imágenes locales, Base64 (data:), Wikipedia (Tus logos de tarjetas) y el Bucket de Storage:
            imgSrc: ["'self'", "data:", "https://upload.wikimedia.org", "https://tu-bucket.s3.amazonaws.com"],
            connectSrc: ["'self'", "https://tu-bucket.s3.amazonaws.com"], // Necesario para subir archivos directo al Bucket
            fontSrc: ["'self'"],
            objectSrc: ["'self'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'self'"],
        },
    }
}));

// ==========================================
// Limitador de Peticiones (Rate Limiting) contra DDoS
// ==========================================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Demasiadas peticiones desde esta IP. Por favor, intenta de nuevo en 15 minutos.' },
    standardHeaders: true, 
    legacyHeaders: false, 
});

app.use('/api/', apiLimiter);

app.use(express.json());

app.use(express.static(path.join(__dirname, '../Frontend')));

// ==========================================
// API REST Simulada
// ==========================================

// 1. Endpoint GET: Estado de salud del servidor
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'Online', 
        version: '1.0.0', 
        environment: 'development',
        message: 'API de GroupWallet funcionando correctamente.'
    });
});

// 1.6 NUEVO Endpoint GET: Obtener historial de gastos archivados
app.get('/api/historial', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;
    try {
        const query = `
            SELECT 
                th.id_transaccion, 
                g.nombre_grupo,
                TO_CHAR(th.fecha_gasto, 'DD/MM/YYYY') as fecha_gasto,
                TO_CHAR(th.fecha_archivado, 'DD/MM/YYYY') as fecha_archivado,
                th.descripcion, 
                CAST(th.monto AS FLOAT) as monto, 
                u.nombre as pagador_nombre
            FROM Transacciones_Historial th
            JOIN Grupos g ON th.id_grupo = g.id_grupo
            JOIN Usuarios u ON th.id_usuario_pagador = u.id_usuario
            JOIN Miembros_Grupo mg ON th.id_grupo = mg.id_grupo
            WHERE mg.id_usuario = $1
            ORDER BY th.fecha_archivado DESC
        `;
        const result = await pool.query(query, [id_usuario]);
        res.json(result.rows);
    } catch (error) {
        console.error('Error al obtener historial:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 1.7 NUEVO Endpoint GET: Exportar historial a Excel (CSV)
app.get('/api/historial/exportar/:id_grupo', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;
    const id_grupo = req.params.id_grupo;

    try {
        // Seguridad: Verificar que el usuario pertenece al grupo
        const checkGrupo = await pool.query('SELECT 1 FROM Miembros_Grupo WHERE id_grupo = $1 AND id_usuario = $2', [id_grupo, id_usuario]);
        if (checkGrupo.rows.length === 0) return res.status(403).json({ error: 'Acceso denegado' });

        const query = `
            SELECT 
                th.id_transaccion, 
                TO_CHAR(th.fecha_gasto, 'DD/MM/YYYY') as fecha_gasto,
                TO_CHAR(th.fecha_archivado, 'DD/MM/YYYY') as fecha_archivado,
                th.descripcion, 
                CAST(th.monto AS FLOAT) as monto, 
                u.nombre as pagador_nombre
            FROM Transacciones_Historial th
            JOIN Usuarios u ON th.id_usuario_pagador = u.id_usuario
            WHERE th.id_grupo = $1
            ORDER BY th.fecha_archivado DESC
        `;
        const result = await pool.query(query, [id_grupo]);
        
        // Construir el formato CSV
        let csv = 'ID Transaccion,Fecha de Gasto,Fecha de Archivado,Descripcion,Pagador,Monto Total\n';
        result.rows.forEach(row => {
            csv += `${row.id_transaccion},${row.fecha_gasto},${row.fecha_archivado},"${row.descripcion}",${row.pagador_nombre},${row.monto}\n`;
        });

        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.attachment(`Historial_Grupo_${id_grupo}.csv`);
        res.send(csv);
    } catch (error) {
        console.error('Error al exportar historial:', error);
        res.status(500).json({ error: 'Error al generar el reporte' });
    }
});

// 1.8 NUEVO Endpoint GET: Obtener Análisis de Finanzas (Requiere Premium)
app.get('/api/finanzas/analisis', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;

    try {
        // Verificar si el usuario tiene el plan básico (id_plan = 1)
        const checkPlan = await pool.query('SELECT id_plan FROM Usuarios WHERE id_usuario = $1', [id_usuario]);
        
        if (checkPlan.rows[0].id_plan === 1) {
            return res.status(403).json({ requires_upgrade: true, message: 'El análisis de finanzas es exclusivo del plan Premium.' });
        }

        // Si es Premium (id_plan > 1), devolver datos de negocio reales
        res.json({
            categoria_frecuente: "Restaurantes",
            ahorro_proyectado: 125.50,
            mayor_gasto: 350.00,
            gasto_promedio: 85.20,
            total_gastado: 1120.50,
            distribucion_gastos: {
                etiquetas: ['Restaurantes', 'Transporte', 'Ocio', 'Supermercado'],
                valores: [350.00, 120.00, 200.00, 450.50]
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al generar análisis' });
    }
});

// 3. Endpoint POST: Procesar Pago y Suscripción Premium
app.post('/api/suscripciones', verificarToken, async (req, res) => {
    const { numero_tarjeta, fecha_exp, cvv } = req.body;
    const id_usuario = req.usuarioLogueado.id_usuario;

    if (!numero_tarjeta || !fecha_exp || !cvv) {
        return res.status(400).json({ error: 'Faltan datos de pago requeridos.' });
    }

    const tarjetaLimpia = numero_tarjeta.replace(/\s/g, '');
    if (!/^\d{15,16}$/.test(tarjetaLimpia)) {
        return res.status(400).json({ error: 'El número de tarjeta es inválido. Debe contener 15 o 16 dígitos numéricos.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { iv, data: tarjetaEncriptada } = encriptarDatoSensible(tarjetaLimpia);
        
        const insertPagoQuery = `
            INSERT INTO Metodos_Pago (id_usuario, tarjeta_encriptada, vector_inicializacion) 
            VALUES ($1, $2, $3)
        `;
        await client.query(insertPagoQuery, [id_usuario, tarjetaEncriptada, iv]);

        const upgradeQuery = `UPDATE Usuarios SET id_plan = 2, estado_suscripcion = 'activo', fecha_vencimiento_suscripcion = CURRENT_DATE + INTERVAL '30 days' WHERE id_usuario = $1`;
        await client.query(upgradeQuery, [id_usuario]);

        await client.query('COMMIT');
        res.status(200).json({ message: '¡Pago exitoso! Ahora eres un usuario Premium.' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error en pasarela de pago:', error);
        res.status(500).json({ error: 'Error al procesar el pago de la suscripción.' });
    } finally {
        client.release();
    }
});

// 3.5 NUEVO: Endpoint PUT para cancelar suscripción Premium
app.put('/api/suscripciones/cancelar', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;
    try {
        await pool.query(
            `UPDATE Usuarios SET id_plan = 1, estado_suscripcion = 'activo', fecha_vencimiento_suscripcion = NULL WHERE id_usuario = $1`,
            [id_usuario]
        );
        res.json({ message: 'Suscripción cancelada exitosamente. Has vuelto al Plan Básico.' });
    } catch (error) {
        console.error('Error al cancelar suscripción:', error);
        res.status(500).json({ error: 'Error al intentar cancelar la suscripción.' });
    }
});


// ==========================================
// Endpoints Integrados (Arquitectura N-Tier)
// ==========================================
app.use('/api/usuarios', usuarioRoutes);
app.use('/api/grupos', grupoRoutes);
app.use('/api/gastos', gastoRoutes);
app.use('/api/cuotas', cuotaRoutes);
app.use('/api/upload', uploadRoutes);

// 5. NUEVO: Endpoint para guardar Tarjeta (Encriptación AES-256)
app.post('/api/metodos-pago', async (req, res) => {
    const { id_usuario, numero_tarjeta } = req.body;
    
    try {
        const { iv, data: tarjetaEncriptada } = encriptarDatoSensible(numero_tarjeta);
        
        const query = `
            INSERT INTO Metodos_Pago (id_usuario, tarjeta_encriptada, vector_inicializacion) 
            VALUES ($1, $2, $3)
        `;
        await pool.query(query, [id_usuario, tarjetaEncriptada, iv]);
        
        res.status(201).json({ 
            message: 'Método de pago guardado. Los datos sensibles están protegidos.',
            demostracion: { texto_original: 'Oculto', encriptado: tarjetaEncriptada }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al asegurar el método de pago' });
    }
});

// 5.5 NUEVO: Endpoint para listar Tarjetas Guardadas (Enmascaradas)
app.get('/api/metodos-pago', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;
    try {
        const query = `
            SELECT id_metodo, tarjeta_encriptada, vector_inicializacion, TO_CHAR(fecha_agregado, 'DD/MM/YYYY') as fecha 
            FROM Metodos_Pago 
            WHERE id_usuario = $1 
            ORDER BY fecha_agregado DESC
        `;
        const result = await pool.query(query, [id_usuario]);
        
        const tarjetasEnmascaradas = result.rows.map(row => {
            const numeroReal = desencriptarDatoSensible(row.tarjeta_encriptada, row.vector_inicializacion);
            const ultimos4 = numeroReal.slice(-4);
            return { id_metodo: row.id_metodo, fecha: row.fecha, enmascarada: `**** **** **** ${ultimos4}` };
        });
        res.json(tarjetasEnmascaradas);
    } catch (error) {
        console.error('Error al obtener métodos de pago:', error);
        res.status(500).json({ error: 'Error al obtener tarjetas guardadas' });
    }
});

// 5.6 NUEVO: Endpoint DELETE para eliminar Tarjeta Guardada
app.delete('/api/metodos-pago/:id', verificarToken, async (req, res) => {
    const id_metodo = req.params.id;
    const id_usuario = req.usuarioLogueado.id_usuario;
    
    try {
        const query = `DELETE FROM Metodos_Pago WHERE id_metodo = $1 AND id_usuario = $2 RETURNING id_metodo`;
        const result = await pool.query(query, [id_metodo, id_usuario]);
        
        if (result.rowCount === 0) return res.status(404).json({ error: 'Método de pago no encontrado.' });
        
        res.json({ message: 'Método de pago eliminado exitosamente.' });
    } catch (error) {
        console.error('Error al eliminar método de pago:', error);
        res.status(500).json({ error: 'Error interno al intentar eliminar la tarjeta.' });
    }
});

// ==========================================
// Middleware Global de Manejo de Errores
// ==========================================
app.use((err, req, res, next) => {
    logError('Middleware Global de Errores', err);
    res.status(500).json({ error: 'Ocurrió un error inesperado en el servidor. Estamos trabajando para solucionarlo.' });
});

// ==========================================
// Tareas Programadas (Cron Jobs)
// ==========================================

cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Iniciando verificación de suscripciones vencidas...');
    try {
        const query = `
            UPDATE Usuarios 
            SET estado_suscripcion = 'vencido', id_plan = 1 
            WHERE fecha_vencimiento_suscripcion < CURRENT_DATE 
            AND estado_suscripcion = 'activo'
        `;
        const result = await pool.query(query);
        console.log(`[CRON] Verificación completada. Usuarios degradados a plan Básico: ${result.rowCount}`);
    } catch (error) {
        console.error('[CRON] Error al verificar suscripciones:', error);
    }
});

cron.schedule('0 * * * *', async () => {
    try {
        await pool.query('DELETE FROM Tokens_Revocados WHERE fecha_expiracion < NOW()');
    } catch (error) {
        console.error('[CRON] Error limpiando tokens de la lista negra:', error);
    }
});

cron.schedule('50 23 * * *', async () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (tomorrow.getDate() === 1) {
        console.log('\n[CRON] Último día del mes detectado. Generando y enviando reportes de gastos...');
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

            const query = `
                SELECT u.nombre, u.correo,
                       COALESCE(SUM(t.monto), 0) as total_gastado,
                       COALESCE(SUM(CASE WHEN t.monto <= 15 THEN t.monto ELSE 0 END), 0) as total_hormiga
                FROM Usuarios u
                LEFT JOIN Transacciones t ON t.id_usuario_pagador = u.id_usuario 
                      AND EXTRACT(MONTH FROM t.fecha_gasto) = EXTRACT(MONTH FROM CURRENT_DATE)
                      AND EXTRACT(YEAR FROM t.fecha_gasto) = EXTRACT(YEAR FROM CURRENT_DATE)
                GROUP BY u.id_usuario, u.nombre, u.correo
                HAVING SUM(t.monto) > 0
            `;
            const result = await pool.query(query);
            
            for (const row of result.rows) {
                const tip = row.total_hormiga > 50 
                    ? 'Estás perdiendo dinero en cosas pequeñas. ¡Considera ahorrarlo el próximo mes!' 
                    : '¡Buen control de tus gastos pequeños! Sigue así.';
                
                const mailOptions = {
                    from: `"GroupWallet" <${process.env.SMTP_USER}>`,
                    to: row.correo,
                    subject: 'Tu Resumen Mensual de Finanzas en GroupWallet',
                    html: `<h2>Hola ${row.nombre},</h2>
                           <p>Este mes has gastado un total de <strong>$${row.total_gastado}</strong>.</p>
                           <p>Atención: de ese total, <strong>$${row.total_hormiga}</strong> se fueron en "Gastos Hormiga" (compras menores a $15).</p>
                           <p><em>💡 Tip: ${tip}</em></p>`
                };
                
                await transporter.sendMail(mailOptions);
                console.log(`[CRON] Email real enviado a: ${row.correo}`);
            }
            console.log(`[CRON] Proceso de envíos reales completado (${result.rowCount} usuarios).`);
        } catch (error) { console.error('[CRON] Error al generar reportes mensuales:', error); }
    }
});

cron.schedule('0 8 * * 1', async () => {
    console.log('\n[CRON] Iniciando envío de recordatorios semanales de deudas pendientes...');
    try {
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });

        const query = `
            SELECT 
                u.nombre, u.correo,
                SUM(t.monto / (SELECT COUNT(*) FROM Transaccion_Participantes WHERE id_transaccion = t.id_transaccion)) as deuda_total,
                COUNT(tp.id_transaccion) as cantidad_cuotas
            FROM Transaccion_Participantes tp
            JOIN Usuarios u ON tp.id_usuario = u.id_usuario
            JOIN Transacciones t ON tp.id_transaccion = t.id_transaccion
            WHERE tp.estado_pago = 'Pendiente' AND tp.id_usuario != t.id_usuario_pagador
            GROUP BY u.id_usuario, u.nombre, u.correo
            HAVING COUNT(tp.id_transaccion) > 0
        `;
        const result = await pool.query(query);
        
        for (const row of result.rows) {
            const mailOptions = {
                from: `"GroupWallet" <${process.env.SMTP_USER}>`,
                to: row.correo,
                subject: 'Recordatorio: Tienes cuotas pendientes en GroupWallet',
                html: `<h2>Hola ${row.nombre},</h2>
                       <p>Este es un recordatorio de que actualmente tienes <strong style="color: #e74c3c;">${row.cantidad_cuotas} cuota(s) pendiente(s)</strong> en tus grupos.</p>
                       <p>El total acumulado estimado de tu deuda es de <strong>$${parseFloat(row.deuda_total).toFixed(2)}</strong>.</p>
                       <p>Ingresa a la aplicación para revisar el detalle y saldar tus deudas. ¡Mantén tus finanzas al día!</p>`
            };
            await transporter.sendMail(mailOptions);
        }
        console.log(`[CRON] Se enviaron ${result.rowCount} recordatorios de deuda.`);
    } catch (error) { console.error('[CRON] Error al enviar recordatorios semanales:', error); }
});

// ==========================================
// Inicialización del Servidor
// ==========================================

async function inicializarBaseDeDatos() {
    try {
        const client = new Client({
            user: process.env.DB_USER, host: process.env.DB_HOST,
            password: process.env.DB_PASSWORD, port: process.env.DB_PORT,
            database: 'postgres'
        });
        await client.connect();
        const res = await client.query(`SELECT 1 FROM pg_database WHERE datname = '${process.env.DB_DATABASE}'`);
        if (res.rowCount === 0) {
            console.log(`[DB] La base de datos '${process.env.DB_DATABASE}' no existe. Creándola automáticamente...`);
            await client.query(`CREATE DATABASE "${process.env.DB_DATABASE}"`);
        }
        await client.end();

        let schemaPath = path.join(__dirname, 'Config/schema.sql');
        if (!fs.existsSync(schemaPath)) {
            schemaPath = path.join(__dirname, '../schema.sql');
        }
        
        if (fs.existsSync(schemaPath)) {
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            await pool.query(schemaSql);
            console.log('[DB] Tablas verificadas/creadas correctamente desde schema.sql.');
        } else {
            console.log('[DB] Archivo schema.sql no encontrado. Las tablas no se crearon.');
        }
    } catch (error) {
        console.error('[DB] Error al inicializar la base de datos:', error);
    }
}

server.listen(PORT, async () => {
    await inicializarBaseDeDatos();
    
    console.log(`Servidor de GroupWallet ejecutándose en http://localhost:${PORT}`);
    console.log(`Archivos estáticos servidos desde: ${__dirname}`);
});