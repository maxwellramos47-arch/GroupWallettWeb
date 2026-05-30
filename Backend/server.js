const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const http = require('http');
const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const webpush = require('web-push');
const { Server } = require('socket.io');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const vision = require('@google-cloud/vision'); // Inicializar Google Vision AI

const prisma = require('./Config/prisma'); // Importar el Singleton de Prisma
const { encriptarDatoSensible, desencriptarDatoSensible, generarFirmaHMAC, JWT_SECRET } = require('./Middleware/security.util');
const { verificarToken, verificarSuperAdmin, verificarPremium } = require('./Middleware/auth.middleware');
const usuarioRoutes = require('./Routes/usuario.routes');
const grupoRoutes = require('./Routes/grupo.routes');
const gastoRoutes = require('./Routes/gasto.routes');
const cuotaRoutes = require('./Routes/cuota.routes');
const uploadRoutes = require('./Routes/upload.routes');
const { logError } = require('./Middleware/logger.util');
const GastoBLL = require('./BLL/gasto.bll');
const EmailTemplates = require('./Routes/emailTemplates');

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// --- Métricas de Uso del Servidor ---
let totalRequests = 0;
app.use((req, res, next) => {
    totalRequests++;
    next();
});

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
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://unpkg.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            // Permitimos imágenes locales, Base64, Wikipedia, S3 y Supabase
            imgSrc: ["'self'", "data:", "https://upload.wikimedia.org", "*.s3.amazonaws.com", "*.supabase.co"],
            connectSrc: ["'self'", "*.s3.amazonaws.com", "*.supabase.co"], // Permite subir a S3 y conectar con Supabase
            fontSrc: ["'self'"],
            objectSrc: ["'self'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'self'"],
        },
    }
}));

// ==========================================
// Lista de Dominios Permitidos (Seguridad)
// ==========================================
const dominiosPermitidos = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'https://groupwallettweb.onrender.com' // Tu dominio activo en Render
].filter(Boolean); // Filtra valores vacíos

// ==========================================
// Configuración de CORS y Cookies HttpOnly
// ==========================================
app.use(cors({
    origin: function (origin, callback) {
        // Permitir si no hay origen (ej. Postman) o si el origen está en la lista blanca
        if (!origin || dominiosPermitidos.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Bloqueado por política CORS'));
        }
    },
    credentials: true // Vital para aceptar envío automático de cookies
}));
app.use(cookieParser());

// ==========================================
// Prevención CSRF: Validación Estricta de Origen
// ==========================================
app.use((req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        const origin = req.headers.origin || req.headers.referer;
        
        const origenValido = origin && dominiosPermitidos.some(d => origin.startsWith(d));
        if (!origenValido) {
            return res.status(403).json({ error: 'Bloqueo de seguridad (CSRF): Origen de petición no confiable.' });
        }
    }
    next();
});

// ==========================================
// Webhooks de MercadoPago (Notificaciones IPN)
// ==========================================
app.post('/api/webhooks/mercadopago', async (req, res) => {
    const { type, data } = req.query; // MP envía type y data.id por query params
    const body = req.body;
    
    const action = type || body.action || body.type;
    const paymentId = (data && data.id) || (body.data && body.data.id);

    if (action === 'payment' && paymentId) {
        try {
            const payment = new Payment(mpClient);
            const payInfo = await payment.get({ id: paymentId });
            
            if (payInfo.status === 'approved') {
                const refId = payInfo.external_reference;
                if (refId) {
                    if (refId.includes('-')) {
                        // 1. Es un pago de cuota In-App (Formato: id_usuario-id_transaccion)
                        const [id_usuario, id_transaccion] = refId.split('-');
                        try {
                            const transaccion = await prisma.transacciones.findUnique({ where: { id_transaccion: parseInt(id_transaccion) } });
                            if (transaccion) {
                                const resultado = await GastoBLL.pagarCuotaInApp(parseInt(id_transaccion), parseInt(id_usuario), transaccion.id_usuario_pagador);
                                io.emit('cuota_pagada', { id_transaccion: parseInt(id_transaccion), id_usuario: parseInt(id_usuario), archivado: resultado?.archivado || false });
                                console.log(`✅ Webhook: Cuota ${id_transaccion} procesada exitosamente vía MercadoPago.`);
                            }
                        } catch (error) { console.error('Aviso Webhook Cuota (Ya procesada):', error.message); }
                    } else {
                        // 2. Es una suscripción Premium
                        try {
                            const treintaDias = new Date();
                            treintaDias.setDate(treintaDias.getDate() + 30);
                            await prisma.usuarios.update({
                                where: { id_usuario: parseInt(refId) },
                                data: { id_plan: 2, estado_suscripcion: 'activo', fecha_vencimiento_suscripcion: treintaDias }
                            });
                            console.log(`✅ Webhook: Suscripción Premium activada para el usuario ${refId}.`);
                        } catch (error) { console.error('Error Webhook Suscripción:', error.message); }
                    }
                }
            }
        } catch (err) { console.error(`⚠️  Webhook Error MP: ${err.message}`); }
    }
    res.status(200).send('OK');
});

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
app.use('/Placeholders', express.static(path.join(__dirname, 'Placeholders')));

// ==========================================
// API REST Simulada
// ==========================================

// 1. Endpoint GET: Estado de salud del servidor
app.get('/api/status', async (req, res) => {
    try {
        // Verificar que la base de datos responde correctamente
        await prisma.$queryRaw`SELECT 1`;
        
        const memory = process.memoryUsage();
        
        res.status(200).json({ 
            status: 'Online',
            database: 'Connected',
            version: '1.0.0', 
            environment: process.env.NODE_ENV || 'production',
            uptime: `${Math.floor(process.uptime() / 60)} minutos`,
            memoryUsage: {
                rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
                heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'Degraded',
            database: 'Disconnected',
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para proveer configuración pública al frontend (Supabase, etc.)
app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: process.env.VITE_SUPABASE_URL,
        supabaseKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    });
});

// 1.6 NUEVO Endpoint GET: Obtener historial de gastos archivados
app.get('/api/historial', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;
    try {
        const result = await prisma.$queryRaw`
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
            WHERE mg.id_usuario = ${parseInt(id_usuario)}
            ORDER BY th.fecha_archivado DESC
        `;
        res.json(result);
    } catch (error) {
        console.error('Error al obtener historial:', error);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// 1.7 NUEVO Endpoint GET: Exportar historial a Excel (CSV)
app.get('/api/historial/exportar/:id_grupo', verificarToken, verificarPremium, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;
    const id_grupo = req.params.id_grupo;

    try {
        // Seguridad: Verificar que el usuario pertenece al grupo
        const checkGrupo = await prisma.miembros_Grupo.findUnique({
            where: { id_grupo_id_usuario: { id_grupo: parseInt(id_grupo), id_usuario: parseInt(id_usuario) } }
        });
        if (!checkGrupo) return res.status(403).json({ error: 'Acceso denegado' });

        const result = await prisma.$queryRaw`
            SELECT 
                th.id_transaccion, 
                TO_CHAR(th.fecha_gasto, 'DD/MM/YYYY') as fecha_gasto,
                TO_CHAR(th.fecha_archivado, 'DD/MM/YYYY') as fecha_archivado,
                th.descripcion, 
                CAST(th.monto AS FLOAT) as monto, 
                u.nombre as pagador_nombre
            FROM Transacciones_Historial th
            JOIN Usuarios u ON th.id_usuario_pagador = u.id_usuario
            WHERE th.id_grupo = ${parseInt(id_grupo)}
            ORDER BY th.fecha_archivado DESC
        `;
        
        // Construir el formato CSV
        let csv = 'ID Transaccion,Fecha de Gasto,Fecha de Archivado,Descripcion,Pagador,Monto Total\n';
        result.forEach(row => {
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
app.get('/api/finanzas/analisis', verificarToken, verificarPremium, async (req, res) => {
    try {
        const id_usuario = req.usuarioLogueado.id_usuario;

        // Obtener todas las transacciones pagadas por el usuario (Activas e Historial)
        const transaccionesActivas = await prisma.$queryRaw`
            SELECT monto, categoria FROM Transacciones WHERE id_usuario_pagador = ${parseInt(id_usuario)}
        `;

        const transaccionesHistorial = await prisma.$queryRaw`
            SELECT monto, categoria FROM Transacciones_Historial WHERE id_usuario_pagador = ${parseInt(id_usuario)}
        `;

        const todasTransacciones = [...transaccionesActivas, ...transaccionesHistorial];

        if (todasTransacciones.length === 0) {
            return res.json({
                categoria_frecuente: "Sin datos",
                ahorro_proyectado: 0,
                mayor_gasto: 0,
                gasto_promedio: 0,
                total_gastado: 0,
                distribucion_gastos: { etiquetas: [], valores: [] }
            });
        }

        let totalGastado = 0;
        let mayorGasto = 0;
        const categoriasMap = {};

        todasTransacciones.forEach(t => {
            const monto = parseFloat(t.monto);
            totalGastado += monto;
            if (monto > mayorGasto) mayorGasto = monto;

            const cat = t.categoria || 'General';
            categoriasMap[cat] = (categoriasMap[cat] || 0) + monto;
        });

        const gastoPromedio = totalGastado / todasTransacciones.length;
        const ahorroProyectado = totalGastado * 0.15; // Proyección sugerida del 15%

        const etiquetas = Object.keys(categoriasMap);
        const valores = Object.values(categoriasMap);

        let categoriaFrecuente = "General";
        let maxMontoCat = 0;
        for (const cat in categoriasMap) {
            if (categoriasMap[cat] > maxMontoCat) {
                maxMontoCat = categoriasMap[cat];
                categoriaFrecuente = cat;
            }
        }

        res.json({
            categoria_frecuente: categoriaFrecuente,
            ahorro_proyectado: ahorroProyectado,
            mayor_gasto: mayorGasto,
            gasto_promedio: gastoPromedio,
            total_gastado: totalGastado,
            distribucion_gastos: { etiquetas, valores }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al generar análisis' });
    }
});

// 1.8.5 NUEVO Endpoint GET: Exportar Gastos Mensuales a Excel (Requiere Premium)
app.get('/api/finanzas/exportar-mensual', verificarToken, verificarPremium, async (req, res) => {
    try {
        const id_usuario = req.usuarioLogueado.id_usuario;
        const { mes, anio } = req.query; 
        
        if (mes === undefined || !anio) return res.status(400).json({ error: 'Faltan parámetros de fecha.' });

        const m = parseInt(mes);
        const a = parseInt(anio);
        
        const fechaInicio = new Date(a, m, 1);
        const fechaFin = new Date(a, m + 1, 0, 23, 59, 59, 999);

        const transacciones = await prisma.transacciones.findMany({
            where: { 
                id_usuario_pagador: parseInt(id_usuario),
                fecha_gasto: { gte: fechaInicio, lte: fechaFin }
            },
            include: { grupo: { select: { nombre_grupo: true } } },
            orderBy: { fecha_gasto: 'desc' }
        });

        // Construir el CSV
        let csv = 'Fecha,Grupo,Categoria,Descripcion,Monto Total\n';
        transacciones.forEach(t => {
            const fechaFormat = t.fecha_gasto ? t.fecha_gasto.toLocaleDateString('es-ES') : '';
            const grupo = t.grupo ? t.grupo.nombre_grupo : 'General';
            csv += `${fechaFormat},"${grupo}","${t.categoria}","${t.descripcion}",${t.monto}\n`;
        });

        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.attachment(`Reporte_Mensual_${m+1}_${a}.csv`);
        res.send(csv);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al exportar los datos mensuales.' });
    }
});

// 1.9 NUEVO Endpoint POST: Leer comprobantes (OCR) con Google Vision AI
app.post('/api/finanzas/ocr', verificarToken, async (req, res) => {
    try {
        const { imageUrl } = req.body;
        if (!imageUrl) return res.status(400).json({ error: 'Falta la URL de la imagen.' });

        // Instanciar el cliente de Google Vision
        const client = new vision.ImageAnnotatorClient();
        
        // Detectar texto en la imagen (ideal para recibos y comprobantes bancarios)
        const [result] = await client.documentTextDetection(imageUrl);
        const fullText = result.fullTextAnnotation ? result.fullTextAnnotation.text : '';

        if (!fullText) {
            return res.json({ monto: null, banco: 'Desconocido', texto_completo: '' });
        }

        // --- 1. Extraer el Banco ---
        const txtLow = fullText.toLowerCase();
        let banco = "Desconocido";
        if (txtLow.includes('estado')) banco = 'Banco Estado';
        else if (txtLow.includes('santander')) banco = 'Banco Santander';
        else if (txtLow.includes('chile')) banco = 'Banco de Chile';
        else if (txtLow.includes('bci')) banco = 'Banco Bci';
        else if (txtLow.includes('falabella')) banco = 'Banco Falabella';
        else if (txtLow.includes('itau') || txtLow.includes('itaú')) banco = 'Banco Itaú';
        else if (txtLow.includes('scotiabank')) banco = 'Scotiabank';
        else if (txtLow.includes('mercado pago')) banco = 'MercadoPago';
        else if (txtLow.includes('tenpo')) banco = 'Tenpo';
        else if (txtLow.includes('mach')) banco = 'Mach';

        // --- 2. Extraer el Monto ---
        // Busca números en formato 10000, 10.000, 10,000, $10000, 10.000,50
        const regex = /[\$]?\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)/g;
        let match;
        const montos = [];
        
        while ((match = regex.exec(fullText)) !== null) {
            let numStr = match[1];
            // Limpiar separadores de miles (asumimos que el punto separa miles y la coma los centavos por defecto)
            if (numStr.includes('.') && !numStr.includes(',')) {
                const partes = numStr.split('.');
                if (partes[partes.length - 1].length === 2) numStr = numStr.replace('.', ','); // Era un decimal disfrazado
                else numStr = numStr.replace(/\./g, ''); // Era un separador de miles
            }
            const numParsed = parseFloat(numStr.replace(',', '.'));
            if (!isNaN(numParsed) && numParsed > 0) montos.push(numParsed);
        }

        const montoMaximo = montos.length > 0 ? Math.max(...montos) : null;
        res.json({ monto: montoMaximo, banco: banco });
    } catch (error) {
        console.error('Error procesando OCR:', error);
        res.status(500).json({ error: 'Error al procesar la imagen con Inteligencia Artificial.' });
    }
});

// 3. Endpoint POST: Generar Enlace de Pago Seguro (MercadoPago Checkout)
app.post('/api/suscripciones/checkout', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;

    try {
        const preference = new Preference(mpClient);
        const result = await preference.create({
            body: {
                items: [{
                    id: 'PREMIUM_PLAN',
                    title: 'Plan Premium GroupWallet (1 Mes)',
                    description: 'Grupos ilimitados y análisis avanzado.',
                    quantity: 1,
                    unit_price: 5000, // $5000 CLP (~$5 USD)
                    currency_id: 'CLP'
                }],
                back_urls: {
                    success: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=success`,
                    failure: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=canceled`,
                    pending: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=canceled`
                },
                auto_return: 'approved',
                external_reference: id_usuario.toString()
            }
        });
        res.json({ url: result.init_point });
    } catch (error) {
        console.error('Error de MercadoPago:', error);
        res.status(500).json({ error: 'Error al conectar con la pasarela de pagos.' });
    }
});

// 3.1 Endpoint POST: Confirmar Pago Exitoso
app.post('/api/suscripciones/confirmar', verificarToken, async (req, res) => {
    const { payment_id } = req.body;
    const id_usuario = req.usuarioLogueado.id_usuario;
    try {
        const payment = new Payment(mpClient);
        const payInfo = await payment.get({ id: payment_id });
        if (payInfo.status === 'approved') {
            const treintaDias = new Date();
            treintaDias.setDate(treintaDias.getDate() + 30);
            await prisma.usuarios.update({
                where: { id_usuario: parseInt(id_usuario) },
                data: { id_plan: 2, estado_suscripcion: 'activo', fecha_vencimiento_suscripcion: treintaDias }
            });
            res.json({ message: '¡Pago verificado exitosamente! Ya eres Premium.' });
        } else { res.status(400).json({ error: 'El pago no ha sido completado.' }); }
    } catch (error) {
        res.status(500).json({ error: 'Error verificando la transacción en MercadoPago.' });
    }
});

// 3.5 NUEVO: Endpoint PUT para cancelar suscripción Premium
app.put('/api/suscripciones/cancelar', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;
    try {
        await prisma.usuarios.update({
            where: { id_usuario: parseInt(id_usuario) },
            data: { id_plan: 1, estado_suscripcion: 'activo', fecha_vencimiento_suscripcion: null }
        });
        res.json({ message: 'Suscripción cancelada exitosamente. Has vuelto al Plan Básico.' });
    } catch (error) {
        console.error('Error al cancelar suscripción:', error);
        res.status(500).json({ error: 'Error al intentar cancelar la suscripción.' });
    }
});

// 3.8 NUEVO Endpoint GET: Obtener Estadísticas Globales (Súper Admin)
app.get('/api/admin/stats', verificarToken, verificarSuperAdmin, async (req, res) => {
    try {
        const totalUsuarios = await prisma.usuarios.count();
        const usuariosPremium = await prisma.usuarios.count({ where: { id_plan: 2 } });
        const usuariosVencidos = await prisma.usuarios.count({ where: { estado_suscripcion: 'vencido' } });
        
        // --- Métricas SaaS Puras (Sin Custodia de Fondos) ---
        const mrr = usuariosPremium * 5000; // MRR: Solo ingresos por membresías
        
        const totalHistoricoPremium = usuariosPremium + usuariosVencidos;
        const churnRate = totalHistoricoPremium > 0 ? (usuariosVencidos / totalHistoricoPremium) * 100 : 0;

        // --- Usuarios en línea (Sesiones activas recientes) ---
        const limiteEnLinea = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 horas (para cubrir el throttle del middleware)
        const enLineaGroup = await prisma.sesiones_Activas.groupBy({
            by: ['id_usuario'],
            where: { ultimo_acceso: { gte: limiteEnLinea } }
        });
        
        const arpa = 5000; // Ingreso Promedio por Cuenta
        
        // --- Cálculo Dinámico del LTV (Basado en duración real de clientes) ---
        const historialPremium = await prisma.usuarios.findMany({
            where: { OR: [{ id_plan: 2 }, { estado_suscripcion: 'vencido' }] },
            select: { fecha_registro: true, fecha_vencimiento_suscripcion: true, estado_suscripcion: true }
        });

        let totalMesesSuscritos = 0;
        historialPremium.forEach(u => {
            if (u.fecha_registro) {
                const fechaFin = (u.estado_suscripcion === 'vencido' && u.fecha_vencimiento_suscripcion) ? new Date(u.fecha_vencimiento_suscripcion) : new Date();
                const diffTime = fechaFin.getTime() - new Date(u.fecha_registro).getTime();
                let diffMeses = diffTime / (1000 * 60 * 60 * 24 * 30.44); // Convertir ms a meses
                totalMesesSuscritos += Math.max(1, diffMeses); // Asumimos al menos 1 mes de retención mínima
            }
        });
        const vidaPromedioMeses = historialPremium.length > 0 ? totalMesesSuscritos / historialPremium.length : 12; // Promedio de 12 si no hay métricas aún
        const ltv = arpa * vidaPromedioMeses;

        // Obtener la sumatoria de todos los gastos de marketing desde Prisma para un CAC exacto
        const mktData = await prisma.gastos_Marketing.aggregate({ _sum: { monto: true } });
        const marketingSpendTotal = mktData._sum.monto ? parseFloat(mktData._sum.monto) : 0;
        const cac = totalUsuarios > 0 ? marketingSpendTotal / totalUsuarios : 0;
        
        const burnRate = 15000; // Costo base servidores y DB (Estimado fijo en CLP)

        const memory = process.memoryUsage();

        res.json({
            total_usuarios: totalUsuarios,
            saas_metrics: { mrr, churn_rate: churnRate, ltv, cac, burn_rate: burnRate },
            server_metrics: {
                total_requests: totalRequests,
                uptime_minutes: Math.floor(process.uptime() / 60),
                ram_mb: Math.round(memory.rss / 1024 / 1024),
                usuarios_en_linea: enLineaGroup.length
            }
        });
    } catch (error) {
        console.error('Error obteniendo stats:', error);
        res.status(500).json({ error: 'Error al obtener las estadísticas.' });
    }
});

// 3.8.1 NUEVO Endpoint POST: Registrar Inversión en Marketing (Súper Admin)
app.post('/api/admin/marketing', verificarToken, verificarSuperAdmin, async (req, res) => {
    try {
        const { monto, descripcion } = req.body;
        if (!monto || isNaN(monto) || monto <= 0) return res.status(400).json({ error: 'Monto inválido.' });
        
        await prisma.gastos_Marketing.create({ data: { monto: parseFloat(monto), descripcion: descripcion || 'Campaña publicitaria' } });
        res.status(201).json({ message: 'Inversión en marketing registrada exitosamente.' });
    } catch (error) {
        console.error('Error registrando gasto de marketing:', error);
        res.status(500).json({ error: 'Error interno al registrar el gasto publicitario.' });
    }
});

// 3.8.2 NUEVO Endpoint GET: Obtener datos para gráficos (Súper Admin)
app.get('/api/admin/chart-data', verificarToken, verificarSuperAdmin, async (req, res) => {
    try {
        const meses = [];
        const cacData = [];
        const mrrData = [];
        
        // Generar los últimos 6 meses
        for (let i = 5; i >= 0; i--) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const mesNombre = d.toLocaleString('es-ES', { month: 'short', year: 'numeric' });
            meses.push(mesNombre);
            
            const primerDia = new Date(d.getFullYear(), d.getMonth(), 1);
            const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

            const mktMes = await prisma.gastos_Marketing.aggregate({ _sum: { monto: true }, where: { fecha_gasto: { gte: primerDia, lte: ultimoDia } } });
            const spend = mktMes._sum.monto ? parseFloat(mktMes._sum.monto) : 0;

            const nuevosUsuarios = await prisma.usuarios.count({ where: { fecha_registro: { gte: primerDia, lte: ultimoDia } } });
            
            cacData.push(nuevosUsuarios > 0 ? Math.round(spend / nuevosUsuarios) : 0);

            const premiumHastaMes = await prisma.usuarios.count({ where: { fecha_registro: { lte: ultimoDia }, id_plan: 2 } });
            mrrData.push(premiumHastaMes * 5000); 
        }

        res.json({ labels: meses, cac: cacData, mrr: mrrData });
    } catch (error) {
        console.error('Error generando chart data:', error);
        res.status(500).json({ error: 'Error al obtener datos del gráfico.' });
    }
});

// 3.8.3 NUEVO Endpoint GET: Obtener Logs del Sistema (Súper Admin)
app.get('/api/admin/logs', verificarToken, verificarSuperAdmin, async (req, res) => {
    try {
        const logPath = path.join(__dirname, '../error.log');
        if (fs.existsSync(logPath)) {
            const logs = fs.readFileSync(logPath, 'utf8');
            res.send(logs || 'No hay logs registrados actualmente.');
        } else {
            res.send('El archivo de logs aún no ha sido creado.');
        }
    } catch (error) {
        console.error('Error leyendo logs:', error);
        res.status(500).send('Error interno al leer los logs del sistema.');
    }
});

// 3.8.4 NUEVO Endpoint DELETE: Limpiar Logs del Sistema (Súper Admin)
app.delete('/api/admin/logs', verificarToken, verificarSuperAdmin, async (req, res) => {
    try {
        const logPath = path.join(__dirname, '../error.log');
        if (fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '');
            res.json({ message: 'Logs limpiados exitosamente.' });
        } else {
            res.json({ message: 'No hay logs para limpiar.' });
        }
    } catch (error) {
        console.error('Error limpiando logs:', error);
        res.status(500).json({ error: 'Error interno al limpiar los logs.' });
    }
});

// 3.9 NUEVO Endpoint GET: Obtener lista de usuarios para gestión (Súper Admin)
app.get('/api/admin/usuarios', verificarToken, verificarSuperAdmin, async (req, res) => {
    try {
        const result = await prisma.usuarios.findMany({
            select: { id_usuario: true, nombre: true, correo: true, id_plan: true, estado_suscripcion: true, fecha_registro: true, bloqueado_hasta: true },
            orderBy: { id_usuario: 'asc' }
        });
        const formattedResult = result.map(u => ({ ...u, fecha: u.fecha_registro ? u.fecha_registro.toLocaleDateString('es-ES') : null }));
        res.json(formattedResult);
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({ error: 'Error al obtener los usuarios.' });
    }
});

// 3.10 NUEVO Endpoint PUT: Cambiar rol/plan de un usuario (Súper Admin)
app.put('/api/admin/usuarios/:id/rol', verificarToken, verificarSuperAdmin, async (req, res) => {
    const id_objetivo = req.params.id;
    const { nuevo_rol } = req.body; // 'FREE', 'PREMIUM', 'GOD_MODE'

    try {
        let id_plan = 1;
        let estado_suscripcion = 'activo';

        if (nuevo_rol === 'PREMIUM') { id_plan = 2; } 
        else if (nuevo_rol === 'GOD_MODE') { 
            const targetCheck = await prisma.usuarios.findUnique({
                where: { id_usuario: parseInt(id_objetivo) },
                select: { correo: true }
            });
            if (!targetCheck || targetCheck.correo !== 'maxwellramos47@gmail.com') {
                return res.status(403).json({ error: 'Operación denegada de forma permanente. El rol Súper Admin está reservado estrictamente para maxwellramos47@gmail.com' });
            }
            id_plan = 2; estado_suscripcion = 'GOD_MODE'; 
        }

        await prisma.usuarios.update({
            where: { id_usuario: parseInt(id_objetivo) },
            data: { id_plan, estado_suscripcion }
        });
        res.json({ message: 'Rol de usuario actualizado exitosamente.' });
    } catch (error) {
        console.error('Error actualizando rol:', error);
        res.status(500).json({ error: 'Error al actualizar el rol del usuario.' });
    }
});

// 3.11 NUEVO Endpoint POST: Forzar Cierre de Sesión (Súper Admin)
app.post('/api/admin/usuarios/:id/forzar-logout', verificarToken, verificarSuperAdmin, async (req, res) => {
    const id_objetivo = req.params.id;

    try {
        // Emitir evento por WebSockets para expulsar al usuario en tiempo real
        req.io.emit('forzar_logout', { id_usuario: parseInt(id_objetivo) });
        
        res.json({ message: 'Orden de cierre de sesión enviada exitosamente.' });
    } catch (error) {
        console.error('Error forzando logout:', error);
        res.status(500).json({ error: 'Error al intentar forzar el cierre de sesión.' });
    }
});

// 3.12 NUEVO Endpoint PUT: Bloquear usuario temporalmente (Súper Admin)
app.put('/api/admin/usuarios/:id/bloquear', verificarToken, verificarSuperAdmin, async (req, res) => {
    const id_objetivo = req.params.id;
    const { horas } = req.body;
    
    try {
        let bloqueado_hasta = null;
        if (horas && horas > 0) {
            bloqueado_hasta = new Date(Date.now() + horas * 60 * 60 * 1000);
        }
        
        await prisma.usuarios.update({
            where: { id_usuario: parseInt(id_objetivo) },
            data: { bloqueado_hasta }
        });
        
        if (bloqueado_hasta) {
            req.io.emit('forzar_logout', { id_usuario: parseInt(id_objetivo) }); // Expulsarlo en tiempo real si está conectado
            res.json({ message: `Usuario bloqueado por ${horas} horas y expulsado del sistema.` });
        } else {
            res.json({ message: 'Usuario desbloqueado exitosamente. Ya puede iniciar sesión.' });
        }
    } catch (error) {
        console.error('Error bloqueando usuario:', error);
        res.status(500).json({ error: 'Error al actualizar el estado de bloqueo del usuario.' });
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

// ==========================================
// Middleware Global de Manejo de Errores
// ==========================================
app.use((err, req, res, next) => {
    logError('Middleware Global de Errores', err);
    res.status(500).json({ error: 'Ocurrió un error inesperado en el servidor. Estamos trabajando para solucionarlo.' });
});

// ==========================================
// Prevención de Caídas Silenciosas
// ==========================================
process.on('uncaughtException', (err) => {
    console.error('💥 CRASH INTERCEPTADO (Uncaught Exception):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 PROMESA FALLIDA NO MANEJADA:', reason);
});

// ==========================================
// Detección de Apagado por el Servidor (Render)
// ==========================================
process.on('SIGTERM', () => {
    console.log('🛑 Render envió señal de apagado (SIGTERM). El servidor entrará en suspensión por inactividad o mantenimiento.');
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('🛑 Señal de interrupción manual (SIGINT). Cerrando servidor...');
    process.exit(0);
});

// ==========================================
// Tareas Programadas (Cron Jobs)
// ==========================================

cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Iniciando verificación de suscripciones vencidas...');
    try {
        const result = await prisma.usuarios.updateMany({
            where: {
                fecha_vencimiento_suscripcion: { lt: new Date() },
                estado_suscripcion: 'activo'
            },
            data: { estado_suscripcion: 'vencido', id_plan: 1 }
        });
        console.log(`[CRON] Verificación completada. Usuarios degradados a plan Básico: ${result.count}`);
    } catch (error) {
        console.error('[CRON] Error al verificar suscripciones:', error);
    }
});

cron.schedule('0 * * * *', async () => {
    try {
        // 1. Limpiar lista negra
        await prisma.tokens_Revocados.deleteMany({
            where: { fecha_expiracion: { lt: new Date() } }
        });
        
        // 2. Limpiar sesiones inactivas (más de 20 días)
        const limiteSesion = new Date();
        limiteSesion.setDate(limiteSesion.getDate() - 20);
        await prisma.sesiones_Activas.deleteMany({
            where: { ultimo_acceso: { lt: limiteSesion } }
        });

        // 3. Limpiar tokens de recuperación de contraseñas expirados
        await prisma.usuarios.updateMany({
            where: { reset_token_expires: { lt: new Date() } },
            data: { reset_token: null, reset_token_expires: null }
        });
    } catch (error) {
        console.error('[CRON] Error limpiando tokens y sesiones expiradas:', error);
    }
});

cron.schedule('50 23 * * *', async () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

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

            const usuarios = await prisma.usuarios.findMany({
                include: {
                    transacciones_pagadas: {
                        where: { fecha_gasto: { gte: startOfMonth, lt: startOfNextMonth } },
                        select: { monto: true }
                    }
                }
            });
            
            const usuariosConGastos = usuarios.map(u => {
                const total = u.transacciones_pagadas.reduce((sum, t) => sum + Number(t.monto), 0);
                const hormiga = u.transacciones_pagadas.reduce((sum, t) => sum + (Number(t.monto) <= 15 ? Number(t.monto) : 0), 0);
                return { nombre: u.nombre, correo: u.correo, total_gastado: total, total_hormiga: hormiga };
            }).filter(u => u.total_gastado > 0);

            for (const row of usuariosConGastos) {
                const tip = row.total_hormiga > 50 
                    ? 'Estás perdiendo dinero en cosas pequeñas. ¡Considera ahorrarlo el próximo mes!' 
                    : '¡Buen control de tus gastos pequeños! Sigue así.';
                
                const mailOptions = {
                    from: `"GroupWallet" <${process.env.SMTP_USER}>`,
                    to: row.correo,
                    subject: 'Tu Resumen Mensual de Finanzas en GroupWallet',
                    html: EmailTemplates.resumenMensual(row.nombre, row.total_gastado, row.total_hormiga, tip)
                };
                
                await transporter.sendMail(mailOptions);
                console.log(`[CRON] Email real enviado a: ${row.correo}`);
            }
            console.log(`[CRON] Proceso de envíos reales completado (${usuariosConGastos.length} usuarios).`);
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

        const usuariosDeudores = await prisma.usuarios.findMany({
            where: { transacciones_participa: { some: { estado_pago: 'Pendiente' } } },
            select: {
                id_usuario: true, nombre: true, correo: true,
                transacciones_participa: {
                    where: { estado_pago: 'Pendiente' },
                    include: {
                        transaccion: { select: { monto: true, id_usuario_pagador: true, _count: { select: { participantes: true } } } }
                    }
                }
            }
        });

        const deudasPorUsuario = usuariosDeudores.map(u => {
            let deuda_total = 0, cantidad_cuotas = 0;
            u.transacciones_participa.forEach(tp => {
                if (tp.transaccion.id_usuario_pagador !== u.id_usuario) {
                    deuda_total += Number(tp.transaccion.monto) / tp.transaccion._count.participantes;
                    cantidad_cuotas++;
                }
            });
            return { nombre: u.nombre, correo: u.correo, deuda_total, cantidad_cuotas };
        }).filter(u => u.cantidad_cuotas > 0);
        
        for (const row of deudasPorUsuario) {
            const mailOptions = {
                from: `"GroupWallet" <${process.env.SMTP_USER}>`,
                to: row.correo,
                subject: 'Recordatorio: Tienes cuotas pendientes en GroupWallet',
                html: EmailTemplates.recordatorioDeudas(row.nombre, row.cantidad_cuotas, row.deuda_total)
            };
            await transporter.sendMail(mailOptions);
        }
        console.log(`[CRON] Se enviaron ${deudasPorUsuario.length} recordatorios de deuda.`);
    } catch (error) { console.error('[CRON] Error al enviar recordatorios semanales:', error); }
});

// Auto-Ping: Algoritmo para mantener Render encendido (Evitar Sleep en Free Tier)
cron.schedule('*/14 * * * *', async () => {
    try {
        await fetch(`http://localhost:${PORT}/api/status`);
    } catch (error) { console.error('[CRON] Auto-ping fallido', error.message); }
});

// ==========================================
// Inicialización del Servidor
// ==========================================

async function inicializarDatosBase() {
    try {
        const count = await prisma.planes_Suscripcion.count();
        if (count === 0) {
            console.log('[DB] Insertando planes de suscripción iniciales...');
            await prisma.planes_Suscripcion.createMany({
                data: [
                    { id_plan: 1, nombre_plan: 'Básico', precio: 0.00, limite_grupos: 3, beneficios: 'Acceso a 3 grupos gratis.' },
                    { id_plan: 2, nombre_plan: 'Premium', precio: 5.00, limite_grupos: 999, beneficios: 'Grupos ilimitados y análisis de finanzas.' }
                ]
            });
            console.log('[DB] Planes creados con éxito.');
        }
    } catch (error) {
        console.error('[DB] Error inicializando datos base:', error);
    }
}

inicializarDatosBase().then(() => {
    server.listen(PORT, () => {
        console.log(`Servidor de GroupWallet en línea y escuchando en el puerto ${PORT}`);
        console.log(`Archivos estáticos servidos desde: ${__dirname}`);
    });
});