const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./security.util');
const pool = require('../Config/db');

async function verificarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(403).json({ error: 'Token no proporcionado. Acceso denegado.' });

    const token = authHeader.split(' ')[1]; // Formato esperado: "Bearer <token>"
    if (!token) return res.status(403).json({ error: 'Formato de token inválido.' });

    try {
        // Verificar si el token ha sido revocado (Ej: Cierre de sesión manual)
        const checkRevocado = await pool.query('SELECT 1 FROM Tokens_Revocados WHERE token = $1', [token]);
        if (checkRevocado.rows.length > 0) return res.status(401).json({ error: 'Sesión cerrada o token revocado.' });

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

module.exports = { verificarToken };