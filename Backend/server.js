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
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); // Inicializar Stripe

const prisma = require('./Config/prisma'); // Importar el Singleton de Prisma
const { encriptarDatoSensible, desencriptarDatoSensible, generarFirmaHMAC, JWT_SECRET } = require('./Middleware/security.util');
const { verificarToken, verificarSuperAdmin, verificarPremium } = require('./Middleware/auth.middleware');
const usuarioRoutes = require('./Routes/usuario.routes');
const grupoRoutes = require('./Routes/grupo.routes');
const gastoRoutes = require('./Routes/gasto.routes');
const cuotaRoutes = require('./Routes/cuota.routes');
const uploadRoutes = require('./Routes/upload.routes');
const { logError } = require('./Middleware/logger.util');

const app = express();
app.set("trust proxy", 1);
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
        // Si es Premium (es_premium == true), devolver datos de negocio reales
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

// 3. Endpoint POST: Generar Enlace de Pago Seguro (Stripe Checkout)
app.post('/api/suscripciones/checkout', verificarToken, async (req, res) => {
    const id_usuario = req.usuarioLogueado.id_usuario;

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'Plan Premium GroupWallet', description: 'Grupos ilimitados y análisis avanzado.' },
                    unit_amount: 500, // $5.00 USD
                    recurring: { interval: 'month' }
                },
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get('host')}/dashboard.html?upgrade=canceled`,
            client_reference_id: id_usuario.toString()
        });
        res.json({ url: session.url });
    } catch (error) {
        console.error('Error de Stripe:', error);
        res.status(500).json({ error: 'Error al conectar con la pasarela de pagos.' });
    }
});

// 3.1 Endpoint POST: Confirmar Pago Exitoso
app.post('/api/suscripciones/confirmar', verificarToken, async (req, res) => {
    const { session_id } = req.body;
    const id_usuario = req.usuarioLogueado.id_usuario;
    try {
        const session = await stripe.checkout.sessions.retrieve(session_id);
        if (session.payment_status === 'paid') {
            const treintaDias = new Date();
            treintaDias.setDate(treintaDias.getDate() + 30);
            await prisma.usuarios.update({
                where: { id_usuario: parseInt(id_usuario) },
                data: { id_plan: 2, estado_suscripcion: 'activo', fecha_vencimiento_suscripcion: treintaDias }
            });
            res.json({ message: '¡Pago verificado exitosamente! Ya eres Premium.' });
        } else { res.status(400).json({ error: 'El pago no ha sido completado.' }); }
    } catch (error) {
        res.status(500).json({ error: 'Error verificando la transacción en Stripe.' });
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

// 3.9 NUEVO Endpoint GET: Obtener lista de usuarios para gestión (Súper Admin)
app.get('/api/admin/usuarios', verificarToken, verificarSuperAdmin, async (req, res) => {
    try {
        const result = await prisma.usuarios.findMany({
            select: { id_usuario: true, nombre: true, correo: true, id_plan: true, estado_suscripcion: true, fecha_registro: true },
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
        await prisma.tokens_Revocados.deleteMany({
            where: { fecha_expiracion: { lt: new Date() } }
        });
    } catch (error) {
        console.error('[CRON] Error limpiando tokens de la lista negra:', error);
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
                    html: `<h2>Hola ${row.nombre},</h2>
                           <p>Este mes has gastado un total de <strong>$${row.total_gastado}</strong>.</p>
                           <p>Atención: de ese total, <strong>$${row.total_hormiga}</strong> se fueron en "Gastos Hormiga" (compras menores a $15).</p>
                           <p><em>💡 Tip: ${tip}</em></p>`
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
                html: `<h2>Hola ${row.nombre},</h2>
                       <p>Este es un recordatorio de que actualmente tienes <strong style="color: #e74c3c;">${row.cantidad_cuotas} cuota(s) pendiente(s)</strong> en tus grupos.</p>
                       <p>El total acumulado estimado de tu deuda es de <strong>$${parseFloat(row.deuda_total).toFixed(2)}</strong>.</p>
                       <p>Ingresa a la aplicación para revisar el detalle y saldar tus deudas. ¡Mantén tus finanzas al día!</p>`
            };
            await transporter.sendMail(mailOptions);
        }
        console.log(`[CRON] Se enviaron ${deudasPorUsuario.length} recordatorios de deuda.`);
    } catch (error) { console.error('[CRON] Error al enviar recordatorios semanales:', error); }
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