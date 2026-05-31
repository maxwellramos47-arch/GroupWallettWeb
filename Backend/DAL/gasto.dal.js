const prisma = require('../Config/prisma');

class GastoDAL {
    static async getAll(id_usuario) {
        return await prisma.$queryRaw`SELECT 
                t.id_transaccion, t.id_grupo, TO_CHAR(t.fecha_gasto, 'DD/MM/YYYY') as fecha,
                t.descripcion, t.categoria, t.comprobante_url, CAST(t.monto AS FLOAT) as monto, t.id_usuario_pagador::text as pagador,
                u.nombre as pagador_nombre, 
                json_agg(json_build_object(
                    'id_usuario', tp.id_usuario::text,
                    'estado_pago', tp.estado_pago,
                    'nombre', up.nombre
                )) as participantes_detalle,
                array_agg(tp.id_usuario::text) as participantes
            FROM Transacciones t
            JOIN Usuarios u ON t.id_usuario_pagador = u.id_usuario
            LEFT JOIN Transaccion_Participantes tp ON t.id_transaccion = tp.id_transaccion
            LEFT JOIN Usuarios up ON tp.id_usuario = up.id_usuario
            WHERE t.id_grupo IN (SELECT id_grupo FROM Miembros_Grupo WHERE id_usuario = ${parseInt(id_usuario)})
            GROUP BY t.id_transaccion, t.id_grupo, t.fecha_gasto, t.descripcion, t.categoria, t.comprobante_url, t.monto, t.id_usuario_pagador, u.nombre
            ORDER BY t.fecha_gasto ASC`;
    }

    static async getGastoInfoAuth(id_transaccion, id_usuario) {
        const result = await prisma.$queryRaw`
            SELECT t.id_usuario_pagador, t.comprobante_url, mg.rol
            FROM Transacciones t
            LEFT JOIN Miembros_Grupo mg ON t.id_grupo = mg.id_grupo AND mg.id_usuario = ${parseInt(id_usuario)}
            WHERE t.id_transaccion = ${parseInt(id_transaccion)}
        `;
        return result.length ? result[0] : null;
    }

    static async countPagos(id_transaccion) {
        const result = await prisma.$queryRaw`SELECT COUNT(*) FROM Transaccion_Participantes WHERE id_transaccion = ${parseInt(id_transaccion)} AND estado_pago = 'Pagado'`;
        return Number(result[0].count);
    }

    static async countPendientes(id_transaccion) {
        const result = await prisma.$queryRaw`SELECT COUNT(*) FROM Transaccion_Participantes WHERE id_transaccion = ${parseInt(id_transaccion)} AND estado_pago = 'Pendiente'`;
        return Number(result[0].count);
    }

    static async getMontoCuota(id_transaccion) {
        const res = await prisma.$queryRaw`
            SELECT t.monto, t.id_usuario_pagador as id_receptor,
                   (SELECT COUNT(*) FROM Transaccion_Participantes WHERE id_transaccion = t.id_transaccion) as total_participantes
            FROM Transacciones t
            WHERE t.id_transaccion = ${parseInt(id_transaccion)}
        `;
        return res.length ? res[0] : null;
    }

    static async createGastoTransaction(id_grupo, pagador, monto, descripcion, categoria, comprobante_url, firma, fecha, participantes) {
        return await prisma.$transaction(async (tx) => {
            let res;
            if (fecha) {
                res = await tx.$queryRaw`INSERT INTO Transacciones (id_grupo, id_usuario_pagador, monto, descripcion, categoria, comprobante_url, firma_hmac, fecha_gasto) VALUES (${parseInt(id_grupo)}, ${parseInt(pagador)}, ${parseFloat(monto)}, ${descripcion}, ${categoria}, ${comprobante_url || null}, ${firma}, ${fecha}::timestamp) RETURNING id_transaccion, TO_CHAR(fecha_gasto, 'DD/MM/YYYY') as fecha`;
            } else {
                res = await tx.$queryRaw`INSERT INTO Transacciones (id_grupo, id_usuario_pagador, monto, descripcion, categoria, comprobante_url, firma_hmac) VALUES (${parseInt(id_grupo)}, ${parseInt(pagador)}, ${parseFloat(monto)}, ${descripcion}, ${categoria}, ${comprobante_url || null}, ${firma}) RETURNING id_transaccion, TO_CHAR(fecha_gasto, 'DD/MM/YYYY') as fecha`;
            }
            const nuevo = res[0];

            for (let p of participantes) {
                await tx.$executeRaw`INSERT INTO Transaccion_Participantes (id_transaccion, id_usuario) VALUES (${nuevo.id_transaccion}, ${parseInt(p)})`;
            }
            
            return { id_transaccion: nuevo.id_transaccion, fecha: nuevo.fecha, descripcion, categoria, comprobante_url, monto: parseFloat(monto), pagador, participantes };
        });
    }

    static async delete(id_transaccion) {
        await prisma.$executeRaw`DELETE FROM Transacciones WHERE id_transaccion = ${parseInt(id_transaccion)}`;
    }

    static async update(id_transaccion, descripcion, categoria, monto, firma_hmac) {
        await prisma.$executeRaw`UPDATE Transacciones SET descripcion = ${descripcion}, categoria = ${categoria}, monto = ${parseFloat(monto)}, firma_hmac = ${firma_hmac} WHERE id_transaccion = ${parseInt(id_transaccion)}`;
    }

    static async updateComprobante(id_transaccion, comprobante_url) {
        const res = await prisma.$executeRaw`UPDATE Transacciones SET comprobante_url = ${comprobante_url} WHERE id_transaccion = ${parseInt(id_transaccion)}`;
        if (res === 0) {
            await prisma.$executeRaw`UPDATE Transacciones_Historial SET comprobante_url = ${comprobante_url} WHERE id_transaccion = ${parseInt(id_transaccion)}`;
        }
    }

    static async checkUserInGroupTransaccion(id_transaccion, id_usuario) {
        const result = await prisma.$queryRaw`SELECT 1 FROM Transacciones t JOIN Miembros_Grupo mg ON t.id_grupo = mg.id_grupo WHERE t.id_transaccion = ${parseInt(id_transaccion)} AND mg.id_usuario = ${parseInt(id_usuario)}`;
        return result.length > 0;
    }

    static async updateCuotaPagada(id_transaccion, id_usuario) {
        const result = await prisma.$executeRaw`UPDATE Transaccion_Participantes SET estado_pago = 'Pagado' WHERE id_transaccion = ${parseInt(id_transaccion)} AND id_usuario = ${parseInt(id_usuario)}`;
        return result > 0;
    }

    static async registerInAppPaymentAndArchive(id_transaccion, id_pagador, id_receptor, monto, comision, total) {
        return await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`
                INSERT INTO Pagos_InApp (id_transaccion, id_usuario_pagador, id_usuario_receptor, monto_original, comision, monto_final)
                VALUES (${parseInt(id_transaccion)}, ${parseInt(id_pagador)}, ${parseInt(id_receptor)}, ${parseFloat(monto)}, ${parseFloat(comision)}, ${parseFloat(total)})
            `;
            await tx.$executeRaw`UPDATE Transaccion_Participantes SET estado_pago = 'Pagado' WHERE id_transaccion = ${parseInt(id_transaccion)} AND id_usuario = ${parseInt(id_pagador)}`;
            
            const pendientes = await tx.$queryRaw`SELECT COUNT(*) FROM Transaccion_Participantes WHERE id_transaccion = ${parseInt(id_transaccion)} AND estado_pago = 'Pendiente'`;
            
            if (Number(pendientes[0].count) === 0) {
                await tx.$executeRaw`INSERT INTO Transacciones_Historial (id_transaccion, id_grupo, id_usuario_pagador, monto, descripcion, categoria, comprobante_url, fecha_gasto, firma_hmac) SELECT id_transaccion, id_grupo, id_usuario_pagador, monto, descripcion, categoria, comprobante_url, fecha_gasto, firma_hmac FROM Transacciones WHERE id_transaccion = ${parseInt(id_transaccion)}`;
                await tx.$executeRaw`INSERT INTO Transaccion_Participantes_Historial (id_transaccion, id_usuario, estado_pago) SELECT id_transaccion, id_usuario, estado_pago FROM Transaccion_Participantes WHERE id_transaccion = ${parseInt(id_transaccion)}`;
                await tx.$executeRaw`DELETE FROM Transacciones WHERE id_transaccion = ${parseInt(id_transaccion)}`;
                return true; 
            }
            return false;
        });
    }

    static async archiveGasto(id_transaccion) {
        return await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`INSERT INTO Transacciones_Historial (id_transaccion, id_grupo, id_usuario_pagador, monto, descripcion, categoria, comprobante_url, fecha_gasto, firma_hmac) SELECT id_transaccion, id_grupo, id_usuario_pagador, monto, descripcion, categoria, comprobante_url, fecha_gasto, firma_hmac FROM Transacciones WHERE id_transaccion = ${parseInt(id_transaccion)}`;
            await tx.$executeRaw`INSERT INTO Transaccion_Participantes_Historial (id_transaccion, id_usuario, estado_pago) SELECT id_transaccion, id_usuario, estado_pago FROM Transaccion_Participantes WHERE id_transaccion = ${parseInt(id_transaccion)}`;
            await tx.$executeRaw`DELETE FROM Transacciones WHERE id_transaccion = ${parseInt(id_transaccion)}`;
        });
    }

    static async getGastoDetailsForNotification(id_transaccion) {
        const gasto = await prisma.transacciones.findUnique({
            where: { id_transaccion: parseInt(id_transaccion) },
            include: {
                pagador: { select: { id_usuario: true, nombre: true, telefono: true, correo: true } },
                participantes: {
                    include: {
                        usuario: { select: { id_usuario: true, nombre: true } }
                    }
                }
            }
        });

        if (!gasto) return null;

        gasto.participantes = gasto.participantes.map(p => ({
            id_usuario: p.usuario.id_usuario,
            nombre: p.usuario.nombre,
            estado_pago: p.estado_pago
        }));
        return gasto;
    }
}

module.exports = GastoDAL;