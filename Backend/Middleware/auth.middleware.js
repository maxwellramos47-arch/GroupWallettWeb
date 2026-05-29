const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./security.util');
const prisma = require('../Config/prisma');

async function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ error: 'Token no proporcionado. Acceso denegado.' });

    const token = authHeader.split(' ')[1]; // Formato esperado: "Bearer <token>"
    if (!token) return res.status(403).json({ error: 'Formato de token inválido.' });

    try {
        // Verificar si el token ha sido revocado (Ej: Cierre de sesión manual)
        const checkRevocado = await prisma.tokens_Revocados.findUnique({
            where: { token }
        });
        if (checkRevocado) return res.status(401).json({ error: 'Sesión cerrada o token revocado.' });

        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) return res.status(401).json({ error: 'Token inválido o expirado.' });
            req.usuarioLogueado = decoded; // Guardamos el payload del token en la request
            req.tokenActual = token; // Guardamos el token exacto por si queremos revocarlo en la ruta
            next();
        });
    } catch (error) {
        res.status(500).json({ error: 'Error interno durante la autenticación.' });
    }
}

// Middleware para proteger rutas de Súper Administrador
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

// Middleware para proteger rutas exclusivas de usuarios Premium
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

        // Permitir si es plan 2 (Premium) o si tiene GOD_MODE
        if (!checkPlan || (checkPlan.id_plan !== 2 && checkPlan.estado_suscripcion !== 'GOD_MODE')) {
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
