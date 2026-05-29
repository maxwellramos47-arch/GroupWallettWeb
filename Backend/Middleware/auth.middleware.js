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
        const checkRevocado = await prisma.tokens_Revocados.findUnique({
            where: { token }
        });
        if (checkRevocado) {
            res.clearCookie('usuarioToken');
            return res.status(401).json({ error: 'Sesión cerrada o token revocado.' });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            
            // Validar si la sesión fue revocada globalmente (Cerrar sesión en todos los dispositivos)
            const user = await prisma.usuarios.findUnique({ 
                where: { id_usuario: parseInt(decoded.id_usuario) }, 
                select: { fecha_revocacion_sesiones: true } 
            });
            
            if (user && user.fecha_revocacion_sesiones && (decoded.iat * 1000 < user.fecha_revocacion_sesiones.getTime())) {
                res.clearCookie('usuarioToken');
                return res.status(401).json({ error: 'La sesión fue revocada globalmente en otro dispositivo.' });
            }

            req.usuarioLogueado = decoded;
            req.tokenActual = token;
            next();
        } catch (err) {
            console.error('Error en verificación de token o Base de Datos:', err.message);
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
            select: { id_plan: true, estado_suscripcion: true, fecha_vencimiento_suscripcion: true }
        });

        const isGod = checkPlan?.estado_suscripcion === 'GOD_MODE';
        const isPremium = checkPlan?.id_plan === 2;
        const hasValidDate = checkPlan?.fecha_vencimiento_suscripcion && new Date(checkPlan.fecha_vencimiento_suscripcion) > new Date();

        if (!checkPlan || (!isGod && !isPremium && !hasValidDate)) {
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
