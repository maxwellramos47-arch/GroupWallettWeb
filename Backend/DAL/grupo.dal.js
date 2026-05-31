const prisma = require('../Config/prisma');

class GrupoDAL {
    static async getUserPlanLimits(id_usuario) {
        const result = await prisma.usuarios.findUnique({
            where: { id_usuario: parseInt(id_usuario) },
            select: {
                plan: { select: { limite_grupos: true } },
                _count: { select: { grupos_creados: true } }
            }
        });
        return { limite_grupos: result.plan.limite_grupos, grupos_creados: result._count.grupos_creados };
    }

    static async create(nombre_grupo, id_creador) {
        const result = await prisma.grupos.create({
            data: { nombre_grupo, id_usuario_creador: parseInt(id_creador) },
            select: { id_grupo: true }
        });
        return result.id_grupo;
    }

    static async getGroupCreatorPlanLimits(id_grupo) {
        const grupo = await prisma.grupos.findUnique({
            where: { id_grupo: parseInt(id_grupo) },
            include: {
                creador: { include: { plan: true } },
                _count: { select: { miembros: true } }
            }
        });
        if (!grupo) return null;
        return {
            limite_miembros: grupo.creador.plan?.limite_miembros_por_grupo || 10,
            miembros_actuales: grupo._count.miembros
        };
    }

    static async addMember(id_grupo, id_usuario, rol) {
        await prisma.miembros_Grupo.create({
            data: { id_grupo: parseInt(id_grupo), id_usuario: parseInt(id_usuario), rol }
        });
    }

    static async getUserGroups(id_usuario, incluir_archivados = false) {
        const whereClause = { id_usuario: parseInt(id_usuario) };
        if (!incluir_archivados) {
            whereClause.grupo = { estado: 'Activo' };
        }

        const result = await prisma.miembros_Grupo.findMany({
            where: whereClause,
            select: { rol: true, grupo: { select: { id_grupo: true, nombre_grupo: true, estado: true, fecha_creacion: true } } }
        });
        
        // Calcular inactividad para sugerencias de archivo (> 3 meses)
        const tresMesesAtras = new Date();
        tresMesesAtras.setMonth(tresMesesAtras.getMonth() - 3);
        
        const response = [];
        for (const r of result) {
            let sugerir_archivar = false;
            if (r.grupo.estado === 'Activo' && r.rol === 'Administrador') {
                const lastTx = await prisma.transacciones.findFirst({
                    where: { id_grupo: r.grupo.id_grupo },
                    orderBy: { fecha_gasto: 'desc' },
                    select: { fecha_gasto: true }
                });
                
                let ultimaFecha = lastTx ? lastTx.fecha_gasto : r.grupo.fecha_creacion;
                
                if (!lastTx) {
                    const lastTxHistorial = await prisma.transacciones_Historial.findFirst({
                        where: { id_grupo: r.grupo.id_grupo },
                        orderBy: { fecha_gasto: 'desc' },
                        select: { fecha_gasto: true }
                    });
                    if (lastTxHistorial) ultimaFecha = lastTxHistorial.fecha_gasto;
                }

                if (ultimaFecha && new Date(ultimaFecha) < tresMesesAtras) {
                    sugerir_archivar = true;
                }
            }
            
            response.push({ id_grupo: r.grupo.id_grupo, nombre_grupo: r.grupo.nombre_grupo, estado: r.grupo.estado || 'Activo', rol: r.rol, sugerir_archivar });
        }
        return response;
    }

    static async getMembers(id_grupo) {
        const result = await prisma.miembros_Grupo.findMany({
            where: { id_grupo: parseInt(id_grupo) },
            select: { usuario: { select: { id_usuario: true, nombre: true, telefono: true } } }
        });
        return result.map(r => r.usuario); // El teléfono vendrá encriptado
    }

    static async getMemberRole(id_grupo, id_usuario) {
        const result = await prisma.miembros_Grupo.findUnique({
            where: { id_grupo_id_usuario: { id_grupo: parseInt(id_grupo), id_usuario: parseInt(id_usuario) } },
            select: { rol: true }
        });
        return result ? result.rol : null;
    }

    static async updateName(id_grupo, nombre_grupo) {
        await prisma.grupos.update({
            where: { id_grupo: parseInt(id_grupo) },
            data: { nombre_grupo }
        });
    }

    static async updateState(id_grupo, estado) {
        await prisma.grupos.update({
            where: { id_grupo: parseInt(id_grupo) },
            data: { estado }
        });
    }

    static async getPendingDebts(id_grupo) {
        const transacciones = await prisma.transacciones.findMany({
            where: { id_grupo: parseInt(id_grupo) },
            include: {
                pagador: { select: { id_usuario: true, nombre: true } },
                participantes: { where: { estado_pago: 'Pendiente' }, include: { usuario: { select: { id_usuario: true, nombre: true } } } },
                _count: { select: { participantes: true } }
            }
        });
        const debts = [];
        for (const t of transacciones) {
            const montoPorPersona = Number(t.monto) / t._count.participantes;
            for (const p of t.participantes) {
                if (p.id_usuario !== t.id_usuario_pagador) {
                    debts.push({ id_acreedor: t.pagador.id_usuario, acreedor_nombre: t.pagador.nombre, id_deudor: p.usuario.id_usuario, deudor_nombre: p.usuario.nombre, monto: montoPorPersona });
                }
            }
        }
        return debts;
    }

    static async getMembersWithPhones(id_grupo) {
        const result = await prisma.miembros_Grupo.findMany({
            where: { id_grupo: parseInt(id_grupo) },
            select: { usuario: { select: { id_usuario: true, nombre: true, telefono: true } } }
        });
        return result.map(r => r.usuario);
    }

    static async removeMember(id_grupo, id_usuario) {
        await prisma.miembros_Grupo.delete({
            where: { id_grupo_id_usuario: { id_grupo: parseInt(id_grupo), id_usuario: parseInt(id_usuario) } }
        });
    }
}

module.exports = GrupoDAL;