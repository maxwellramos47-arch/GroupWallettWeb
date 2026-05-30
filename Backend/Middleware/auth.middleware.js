const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./security.util');
const prisma = require('../Config/prisma');

async function verificarToken(req, res, next) {
    // Buscar el token en las cookies HttpOnly (Método primario)
    let token = req.cookies.usuarioToken;
    
    // Fallback por si la petición viene de Postman o una App Móvil
    if (!token && req.headers['authorization']) {
        token = req.headers['authorization'].split(' ')[1];
    }
    
    // Ignorar el token de reemplazo del Frontend
    if (token === 'http-only-cookie') token = req.cookies.usuarioToken;

    if (!token) return res.status(401).json({ error: 'Sesión expirada o no proporcionada.' });

    try {
        // 1. Verificación Estricta en Base de Datos (Whitelist)
        const sesionActiva = await prisma.sesiones_Activas.findUnique({
            where: { token }
        });

        if (!sesionActiva) {
            res.clearCookie('usuarioToken');
            return res.status(401).json({ error: 'Sesión no encontrada en la base de datos o ya fue cerrada.' });
        }

        // 2. Verificar que no esté en la lista negra (Blacklist)
        const checkRevocado = await prisma.tokens_Revocados.findUnique({
            where: { token }
        });
        if (checkRevocado) {
            res.clearCookie('usuarioToken');
            return res.status(401).json({ error: 'Sesión revocada por el sistema.' });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            // 3. Validar estado del usuario
            const user = await prisma.usuarios.findUnique({ 
                where: { id_usuario: parseInt(decoded.id_usuario) }, 
                select: { fecha_revocacion_sesiones: true, bloqueado_hasta: true } 
            });
            
            if (user && user.fecha_revocacion_sesiones && (decoded.iat * 1000 < user.fecha_revocacion_sesiones.getTime())) {
                res.clearCookie('usuarioToken');
                return res.status(401).json({ error: 'La sesión fue revocada globalmente en otro dispositivo.' });
            }

            if (user && user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
                res.clearCookie('usuarioToken');
                return res.status(401).json({ error: 'Tu cuenta se encuentra bloqueada temporalmente.' });
            }

            // 4. Throttle para actualizar último acceso (Máximo 1 vez por hora para no saturar DB)
            const ahora = Date.now();
            const ultimoAcceso = sesionActiva.ultimo_acceso.getTime();
            if (ahora - ultimoAcceso > 3600000) { 
                await prisma.sesiones_Activas.update({
                    where: { id_sesion: sesionActiva.id_sesion },
                    data: { ultimo_acceso: new Date() }
                });
            }

            req.usuarioLogueado = decoded;
            req.tokenActual = token;
            next();
        } catch (err) {
            // Si el JWT expiró matemáticamente, limpiar la DB
            await prisma.sesiones_Activas.deleteMany({ where: { token } });
            console.error('Sesión expirada, token eliminado de DB:', err.message);
            res.clearCookie('usuarioToken');
            return res.status(401).json({ error: 'Token inválido o expirado.' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Error interno durante la autenticación.' });
    }
}

const verificarSuperAdmin = async (req, res, next) => {
    try {
        const id_usuario = req.usuarioLogueado?.id_usuario;
        
        if (!id_usuario) {
            return res.status(401).json({ error: 'No se pudo identificar al usuario.' });
        }

        const userCheck = await prisma.usuarios.findUnique({
            where: { id_usuario: parseInt(id_usuario) },
            select: { estado_suscripcion: true }
        });

        if (!userCheck || userCheck.estado_suscripcion !== 'GOD_MODE') {
            return res.status(403).json({ error: 'Acceso denegado. Esta acción requiere privilegios de Súper Administrador.' });
        }

        next();
    } catch (error) {
        console.error('Error en middleware verificarSuperAdmin:', error);
        res.status(500).json({ error: 'Error interno al validar los permisos del usuario.' });
    }
};

const verificarPremium = async (req, res, next) => {
    try {
        const id_usuario = req.usuarioLogueado?.id_usuario;
        
        if (!id_usuario) {
            return res.status(401).json({ error: 'No se pudo identificar al usuario.' });
        }

        const checkPlan = await prisma.usuarios.findUnique({
            where: { id_usuario: parseInt(id_usuario) },
            select: { id_plan: true, estado_suscripcion: true }
        });

        const isGod = checkPlan?.estado_suscripcion === 'GOD_MODE';
        const isPremium = checkPlan?.id_plan === 2 && checkPlan?.estado_suscripcion === 'activo';

        if (!checkPlan || (!isGod && !isPremium)) {
            return res.status(403).json({ requires_upgrade: true, message: 'Esta función es exclusiva del plan Premium. Mejora tu plan para acceder.' });
        }

        next();
    } catch (error) {
        console.error('Error en middleware verificarPremium:', error);
        res.status(500).json({ error: 'Error interno al validar los permisos Premium.' });
    }
};

module.exports = { 
    verificarToken, 
    verificarSuperAdmin, 
    verificarPremium 
};
