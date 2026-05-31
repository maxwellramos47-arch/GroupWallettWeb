const prisma = require('../Config/prisma');
const Usuario = require('../Entities/Usuario');

class UsuarioDAL {
    static async create(nombre, correo, correoVerificado, telefono, telefonoHash, passwordHash, telefonoVerificado) {
        const data = { nombre, password_hash: passwordHash };
        if (correo) { data.correo = correo; data.correo_verificado = correoVerificado; }
        if (telefono) { data.telefono = telefono; data.telefono_hash = telefonoHash; data.telefono_verificado = telefonoVerificado; }
        
        const user = await prisma.usuarios.create({ data });
        return user.id_usuario;
    }

    static async findByIdentifier(identificador) {
        const user = await prisma.usuarios.findFirst({
            where: {
                OR: [
                    { correo: identificador },
                    { telefono_hash: identificador }
                ]
            }
        });
        return user ? new Usuario(user) : null;
    }

    static async findById(id) {
        const user = await prisma.usuarios.findUnique({ where: { id_usuario: id } });
        return user ? new Usuario(user) : null;
    }

    static async updateProfile(id_usuario, nombre, telefono, foto_url, passwordHash = null) {
        const data = {};
        if (nombre) data.nombre = nombre;
        // Nota: el teléfono se actualiza en el método dedicado de contacto para mantener su encriptación y Hash
        if (foto_url !== undefined) data.foto_url = foto_url; // Permite almacenar explícitamente "null"
        if (passwordHash) data.password_hash = passwordHash;
        
        await prisma.usuarios.update({ where: { id_usuario }, data });
    }

    static async updateContactMethod(id_usuario, data) {
        await prisma.usuarios.update({ where: { id_usuario }, data });
    }

    static async getPasswordHash(id_usuario) {
        const user = await prisma.usuarios.findUnique({ where: { id_usuario }, select: { password_hash: true } });
        return user ? user.password_hash : null;
    }

    static async setResetToken(correo, token, expireDate) {
        const user = await prisma.usuarios.updateMany({
            where: { correo },
            data: { reset_token: token, reset_token_expires: expireDate }
        });
        return user.count > 0;
    }

    static async findByResetToken(token) {
        const user = await prisma.usuarios.findFirst({
            where: { reset_token: token, reset_token_expires: { gt: new Date() } }
        });
        return user ? user.id_usuario : null;
    }

    static async incrementFailedAttempts(id_usuario) {
        // En operaciones condicionales muy complejas, Prisma permite inyectar SQL crudo cuando es estrictamente necesario
        const result = await prisma.$queryRaw`
            UPDATE Usuarios 
            SET intentos_fallidos = intentos_fallidos + 1,
                bloqueado_hasta = CASE WHEN intentos_fallidos + 1 >= 5 THEN NOW() + INTERVAL '15 minutes' ELSE bloqueado_hasta END
            WHERE id_usuario = ${parseInt(id_usuario)}
            RETURNING intentos_fallidos, bloqueado_hasta
        `;
        return result[0];
    }

    static async resetFailedAttempts(id_usuario) {
        await prisma.usuarios.update({
            where: { id_usuario },
            data: { intentos_fallidos: 0, bloqueado_hasta: null }
        });
    }

    static async upsertDatosBancarios(id_usuario, rut, banco, tipo_cuenta, numero_cuenta, correo) {
        await prisma.datos_Bancarios.upsert({
            where: { id_usuario },
            update: { rut, banco, tipo_cuenta, numero_cuenta, correo },
            create: { id_usuario, rut, banco, tipo_cuenta, numero_cuenta, correo }
        });
    }

    static async getDatosBancarios(id_usuario) {
        return await prisma.datos_Bancarios.findUnique({
            where: { id_usuario },
            select: { rut: true, banco: true, tipo_cuenta: true, numero_cuenta: true, correo: true }
        });
    }

    static async updatePushSubscription(id_usuario, push_subscription) {
        await prisma.usuarios.update({
            where: { id_usuario },
            data: { push_subscription }
        });
    }

    static async getPushSubscription(id_usuario) {
        const user = await prisma.usuarios.findUnique({ where: { id_usuario }, select: { push_subscription: true }});
        return user ? user.push_subscription : null;
    }

    static async enableGodMode(id_usuario) {
        await prisma.usuarios.update({
            where: { id_usuario },
            data: { estado_suscripcion: 'GOD_MODE', id_plan: 2 }
        });
    }

    static async updatePasswordRecoveryRateLimit(id_usuario, attempts, blockUntil) {
        await prisma.usuarios.update({
            where: { id_usuario: parseInt(id_usuario) },
            data: {
                recuperacion_intentos: attempts,
                recuperacion_bloqueado_hasta: blockUntil
            }
        });
    }
}

module.exports = UsuarioDAL;