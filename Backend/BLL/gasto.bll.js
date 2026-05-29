const GastoDAL = require('../DAL/gasto.dal');
const GrupoDAL = require('../DAL/grupo.dal');
const UsuarioDAL = require('../DAL/usuario.dal');
const { generarFirmaHMAC } = require('../Middleware/security.util');
const webpush = require('web-push');

class GastoBLL {
    static async obtenerGastos() {
        return await GastoDAL.getAll();
    }

    static async crearGasto(id_grupo, descripcion, categoria, monto, pagador, participantes, fecha, comprobante_url, id_solicitante) {
        if (!id_grupo || !descripcion || !monto || !pagador || !participantes || participantes.length === 0) throw new Error('Faltan datos requeridos.');
        
        const rol = await GrupoDAL.getMemberRole(id_grupo, id_solicitante);
        const user = await UsuarioDAL.findById(id_solicitante);
        const isGod = user.estado_suscripcion === 'GOD_MODE';
        if (rol !== 'Administrador' && !isGod) throw new Error('Acceso denegado. Solo los administradores pueden crear gastos.');

        const firma = generarFirmaHMAC(`${pagador}-${monto}-${descripcion}-${categoria}`);
        
        const nuevoGasto = await GastoDAL.createGastoTransaction(id_grupo, pagador, monto, descripcion, categoria, comprobante_url, firma, fecha, participantes);
        
        const payloadPush = JSON.stringify({
            title: '💸 Nuevo cobro registrado',
            body: `Te han asignado una cuota por: ${descripcion}. ¡Abre GroupWallet para revisar!`,
            url: '/dashboard.html'
        });

        for (let p of participantes) {
            if (p != pagador) {
                try {
                    const subStr = await UsuarioDAL.getPushSubscription(parseInt(p));
                    if (subStr) await webpush.sendNotification(JSON.parse(subStr), payloadPush);
                } catch (error) { console.error(`No se pudo notificar al usuario ${p}`); }
            }
        }
        
        return nuevoGasto;
    }

    static async eliminarGasto(id_transaccion, id_solicitante) {
        const info = await GastoDAL.getGastoInfoAuth(id_transaccion, id_solicitante);
        if (!info) throw new Error('Gasto no encontrado.');
        const user = await UsuarioDAL.findById(id_solicitante);
        const isGod = user.estado_suscripcion === 'GOD_MODE';
        if (info.rol !== 'Administrador' && info.id_usuario_pagador != id_solicitante && !isGod) throw new Error('Acceso denegado. No tienes permiso.');
        
        if (await GastoDAL.countPagos(id_transaccion) > 0) throw new Error('No se puede eliminar porque uno o más participantes ya han pagado.');
        await GastoDAL.delete(id_transaccion);
    }

    static async editarGasto(id_transaccion, descripcion, categoria, monto, id_solicitante) {
        if (!descripcion || isNaN(monto) || parseFloat(monto) <= 0) throw new Error('Datos inválidos.');
        const info = await GastoDAL.getGastoInfoAuth(id_transaccion, id_solicitante);
        if (!info) throw new Error('Gasto no encontrado.');
        const user = await UsuarioDAL.findById(id_solicitante);
        const isGod = user.estado_suscripcion === 'GOD_MODE';
        if (info.rol !== 'Administrador' && info.id_usuario_pagador != id_solicitante && !isGod) throw new Error('Acceso denegado.');
        
        if (await GastoDAL.countPagos(id_transaccion) > 0) throw new Error('No se puede editar porque uno o más participantes ya han pagado.');
        await GastoDAL.update(id_transaccion, descripcion, categoria, parseFloat(monto), generarFirmaHMAC(`${info.id_usuario_pagador}-${parseFloat(monto)}-${descripcion}-${categoria}`));
    }

    static async pagarCuota(id_transaccion, id_usuario, id_solicitante) {
        if (!await GastoDAL.checkUserInGroupTransaccion(id_transaccion, id_solicitante)) throw new Error('Acceso denegado. No perteneces al grupo.');
        if (!await GastoDAL.updateCuotaPagada(id_transaccion, id_usuario)) throw new Error('Cuota no encontrada.');

        const pendientes = await GastoDAL.countPendientes(id_transaccion);
        if (pendientes === 0) await GastoDAL.archiveGasto(id_transaccion);
        
        return pendientes === 0;
    }

    static async pagarCuotaInApp(id_transaccion, id_usuario, id_solicitante) {
        if (!await GastoDAL.checkUserInGroupTransaccion(id_transaccion, id_solicitante)) throw new Error('Acceso denegado. No perteneces al grupo.');
        if (id_usuario != id_solicitante) throw new Error('Solo puedes pagar tus propias cuotas a través de la app.');
        
        const info = await GastoDAL.getMontoCuota(id_transaccion);
        if (!info) throw new Error('Transacción no encontrada.');

        const montoBase = parseFloat(info.monto) / parseInt(info.total_participantes);
        const comision = montoBase * 0.0089;
        const total = montoBase + comision;

        const archivado = await GastoDAL.registerInAppPaymentAndArchive(id_transaccion, id_usuario, info.id_receptor, montoBase, comision, total);
        
        return { archivado, montoBase, comision, total };
    }
}
module.exports = GastoBLL;