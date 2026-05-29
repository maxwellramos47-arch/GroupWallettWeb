const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UsuarioDAL = require('../DAL/usuario.dal');
const { JWT_SECRET } = require('../Middleware/security.util');

class UsuarioBLL {
    static async registrar(nombre, correo, password) {
        const passwordHash = await bcrypt.hash(password, 10);
        return await UsuarioDAL.create(nombre, correo, passwordHash);
    }

    static async login(correo, password) {
        const usuario = await UsuarioDAL.findByEmail(correo);
        if (!usuario) throw new Error('Usuario no encontrado o credenciales inválidas.');

        // Verificar si la cuenta está bloqueada temporalmente
        if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
            const minutosRestantes = Math.ceil((new Date(usuario.bloqueado_hasta) - new Date()) / 60000);
            throw new Error(`Cuenta bloqueada por seguridad. Intenta de nuevo en ${minutosRestantes} minuto(s).`);
        }

        const match = await bcrypt.compare(password, usuario.password_hash);
        if (!match) {
            // Incrementar intentos y verificar si llegó al límite
            const { intentos_fallidos } = await UsuarioDAL.incrementFailedAttempts(usuario.id_usuario);
            if (intentos_fallidos >= 5) {
                throw new Error('Demasiados intentos fallidos. Tu cuenta ha sido bloqueada por 15 minutos.');
            }
            throw new Error(`Contraseña incorrecta. Te quedan ${5 - intentos_fallidos} intento(s).`);
        }

        // Si el login es exitoso, reiniciar el contador de fallos
        await UsuarioDAL.resetFailedAttempts(usuario.id_usuario);

        const token = jwt.sign(
            { id_usuario: usuario.id_usuario, correo: usuario.correo },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        return { token, usuario };
    }

    static async obtenerPerfil(id_usuario) {
        const usuario = await UsuarioDAL.findById(id_usuario);
        if (!usuario) throw new Error('Usuario no encontrado');
        return { nombre: usuario.nombre, correo: usuario.correo, telefono: usuario.telefono, id_plan: usuario.id_plan, foto_url: usuario.foto_url };
    }

    static async actualizarPerfil(id_usuario, nombre, telefono, foto_url, password) {
        const hash = (password && password.trim() !== '') ? await bcrypt.hash(password, 10) : null;
        await UsuarioDAL.updateProfile(id_usuario, nombre, telefono, foto_url, hash);
    }

    static async solicitarRecuperacion(correo) {
        const token = crypto.randomBytes(20).toString('hex');
        const success = await UsuarioDAL.setResetToken(correo, token, new Date(Date.now() + 3600000));
        if (!success) throw new Error('Correo no encontrado en el sistema.');
        return token;
    }

    static async restablecerPassword(token, new_password) {
        const id_usuario = await UsuarioDAL.findByResetToken(token);
        if (!id_usuario) throw new Error('Token inválido o expirado. Solicita uno nuevo.');
        await UsuarioDAL.updateProfile(id_usuario, null, await bcrypt.hash(new_password, 10)); // Reutilizamos updateProfile reseteando campos nulos en BD
    }

    static async guardarBanco(id_usuario, rut, banco, tipo_cuenta, numero_cuenta, correo) {
        if (!rut || !numero_cuenta) throw new Error('Debes proporcionar al menos tu RUT y un Número de Cuenta para recibir transferencias.');
        
        // Validación de formato de RUT Chileno usando Expresiones Regulares
        const rutRegex = /^[0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3}-[0-9Kk]{1}$/;
        if (!rutRegex.test(rut)) throw new Error('El formato del RUT es inválido. Ejemplos válidos: 12.345.678-9 o 12345678-k.');
        
        await UsuarioDAL.upsertDatosBancarios(id_usuario, rut, banco, tipo_cuenta, numero_cuenta, correo);
    }

    static async obtenerBanco(id_usuario) {
        return await UsuarioDAL.getDatosBancarios(id_usuario);
    }

    static async guardarSuscripcionPush(id_usuario, push_subscription) {
        await UsuarioDAL.updatePushSubscription(id_usuario, push_subscription);
    }

    static async activarGodMode(id_usuario) {
        await UsuarioDAL.enableGodMode(id_usuario);
    }
}

module.exports = UsuarioBLL;