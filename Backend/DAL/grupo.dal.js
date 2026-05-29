const prisma = require('../Config/prisma');

class GrupoDAL {
    static async getUserPlanLimits(id_usuario) {
        const result = await prisma.$queryRawUnsafe(`
            SELECT p.limite_grupos, (SELECT COUNT(*) FROM Grupos WHERE id_usuario_creador = ${parseInt(id_usuario)}) as grupos_creados
            FROM Usuarios u JOIN Planes_Suscripcion p ON u.id_plan = p.id_plan WHERE u.id_usuario = ${parseInt(id_usuario)}
        `);
        return result[0];
    }

    static async create(nombre_grupo, id_creador) {
        const result = await prisma.$queryRaw`INSERT INTO Grupos (nombre_grupo, id_usuario_creador) VALUES (${nombre_grupo}, ${parseInt(id_creador)}) RETURNING id_grupo`;
        return result[0].id_grupo;
    }

    static async addMember(id_grupo, id_usuario, rol) {
        await prisma.$executeRaw`INSERT INTO Miembros_Grupo (id_grupo, id_usuario, rol) VALUES (${parseInt(id_grupo)}, ${parseInt(id_usuario)}, ${rol})`;
    }

    static async getUserGroups(id_usuario) {
        return await prisma.$queryRaw`
            SELECT g.id_grupo, g.nombre_grupo, mg.rol 
            FROM Grupos g JOIN Miembros_Grupo mg ON g.id_grupo = mg.id_grupo WHERE mg.id_usuario = ${parseInt(id_usuario)}
        `;
    }

    static async getMembers(id_grupo) {
        return await prisma.$queryRaw`
            SELECT u.id_usuario, u.nombre 
            FROM Usuarios u JOIN Miembros_Grupo mg ON u.id_usuario = mg.id_usuario WHERE mg.id_grupo = ${parseInt(id_grupo)}
        `;
    }

    static async getMemberRole(id_grupo, id_usuario) {
        const result = await prisma.$queryRaw`SELECT rol FROM Miembros_Grupo WHERE id_grupo = ${parseInt(id_grupo)} AND id_usuario = ${parseInt(id_usuario)}`;
        return result.length ? result[0].rol : null;
    }

    static async updateName(id_grupo, nombre_grupo) {
        await prisma.$executeRaw`UPDATE Grupos SET nombre_grupo = ${nombre_grupo} WHERE id_grupo = ${parseInt(id_grupo)}`;
    }

    static async getPendingDebts(id_grupo) {
        return await prisma.$queryRaw`
            SELECT 
                t.id_usuario_pagador as id_acreedor,
                ua.nombre as acreedor_nombre,
                tp.id_usuario as id_deudor,
                ud.nombre as deudor_nombre,
                (t.monto / (SELECT COUNT(*) FROM Transaccion_Participantes WHERE id_transaccion = t.id_transaccion)) as monto
            FROM Transacciones t
            JOIN Transaccion_Participantes tp ON t.id_transaccion = tp.id_transaccion
            JOIN Usuarios ua ON t.id_usuario_pagador = ua.id_usuario
            JOIN Usuarios ud ON tp.id_usuario = ud.id_usuario
            WHERE t.id_grupo = ${parseInt(id_grupo)} AND tp.estado_pago = 'Pendiente' AND tp.id_usuario != t.id_usuario_pagador
        `;
    }

    static async getMembersWithPhones(id_grupo) {
        return await prisma.$queryRaw`
            SELECT u.id_usuario, u.nombre, u.telefono 
            FROM Usuarios u JOIN Miembros_Grupo mg ON u.id_usuario = mg.id_usuario WHERE mg.id_grupo = ${parseInt(id_grupo)}
        `;
    }

    static async removeMember(id_grupo, id_usuario) {
        await prisma.$executeRaw`DELETE FROM Miembros_Grupo WHERE id_grupo = ${parseInt(id_grupo)} AND id_usuario = ${parseInt(id_usuario)}`;
    }
}

module.exports = GrupoDAL;