const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const UsuarioDAL = require('../DAL/usuario.dal');
const { JWT_SECRET, safeEncrypt, safeDecrypt } = require('../Middleware/security.util');

class UsuarioBLL {
    static async registrar(nombre, correo, telefono, password) {
        const passwordHash = await bcrypt.hash(password, 10);
        const telefonoSeguro = safeEncrypt(telefono);
        return await UsuarioDAL.create(nombre, correo, telefonoSeguro, passwordHash);
    }

    static async login(correo, password, rememberMe = false) {
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

        const expiresIn = rememberMe ? '30d' : '2h';
        const token = jwt.sign(
            { id_usuario: usuario.id_usuario, correo: usuario.correo },
            JWT_SECRET,
            { expiresIn }
        );

        return { token, usuario };
    }

    static async obtenerPerfil(id_usuario) {
        const usuario = await UsuarioDAL.findById(id_usuario);
        if (!usuario) throw new Error('Usuario no encontrado');
        return { nombre: usuario.nombre, correo: usuario.correo, telefono: safeDecrypt(usuario.telefono), id_plan: usuario.id_plan, estado_suscripcion: usuario.estado_suscripcion, foto_url: usuario.foto_url };
    }

    static async actualizarPerfil(id_usuario, nombre, telefono, foto_url, password_actual, nueva_password) {
        let hash = null;
        if (nueva_password && nueva_password.trim() !== '') {
            const hashActualDb = await UsuarioDAL.getPasswordHash(id_usuario);
            const match = await bcrypt.compare(password_actual || '', hashActualDb);
            if (!match) throw new Error('La contraseña actual es incorrecta.');
            hash = await bcrypt.hash(nueva_password, 10);
        }
        const telefonoSeguro = safeEncrypt(telefono);
        await UsuarioDAL.updateProfile(id_usuario, nombre, telefonoSeguro, foto_url, hash);
    }

    static async solicitarRecuperacion(correo) {
        const token = crypto.randomBytes(20).toString('hex');
        const success = await UsuarioDAL.setResetToken(correo, token, new Date(Date.now() + 15 * 60 * 1000)); // Expiración en 15 minutos
        if (!success) throw new Error('Correo no encontrado en el sistema.');
        return token;
    }

    static async restablecerPassword(token, new_password) {
        const id_usuario = await UsuarioDAL.findByResetToken(token);
        if (!id_usuario) throw new Error('Token inválido o expirado. Solicita uno nuevo.');
        const hash = await bcrypt.hash(new_password, 10);
        await UsuarioDAL.updateProfile(id_usuario, undefined, undefined, undefined, hash); // Evita sobrescribir nombre/telefono
    }

    static async guardarBanco(id_usuario, rut, banco, tipo_cuenta, numero_cuenta, correo) {
        if (!rut || !numero_cuenta) throw new Error('Debes proporcionar al menos tu RUT y un Número de Cuenta para recibir transferencias.');
        
        // Validación de formato de RUT Chileno usando Expresiones Regulares
        const rutRegex = /^[0-9]{1,2}\.?[0-9]{3}\.?[0-9]{3}-[0-9Kk]{1}$/;
        if (!rutRegex.test(rut)) throw new Error('El formato del RUT es inválido. Ejemplos válidos: 12.345.678-9 o 12345678-k.');
        
        const rutEncriptado = safeEncrypt(rut);
        const cuentaEncriptada = safeEncrypt(numero_cuenta);
        await UsuarioDAL.upsertDatosBancarios(id_usuario, rutEncriptado, banco, tipo_cuenta, cuentaEncriptada, correo);
    }

    static async obtenerBanco(id_usuario) {
        const datos = await UsuarioDAL.getDatosBancarios(id_usuario);
        if (datos) {
            datos.rut = safeDecrypt(datos.rut);
            datos.numero_cuenta = safeDecrypt(datos.numero_cuenta);
        }
        return datos;
    }

    static async guardarSuscripcionPush(id_usuario, push_subscription) {
        await UsuarioDAL.updatePushSubscription(id_usuario, push_subscription);
    }

    static async activarGodMode(id_usuario) {
        await UsuarioDAL.enableGodMode(id_usuario);
    }
}

module.exports = UsuarioBLL;