class Usuario {
    constructor({ id_usuario, nombre, correo, password_hash, fecha_registro, id_plan, estado_suscripcion, fecha_vencimiento_suscripcion, intentos_fallidos, bloqueado_hasta, foto_url }) {
        this.id_usuario = id_usuario;
        this.nombre = nombre;
        this.correo = correo;
        this.password_hash = password_hash;
        this.fecha_registro = fecha_registro;
        this.id_plan = id_plan;
        this.estado_suscripcion = estado_suscripcion;
        this.fecha_vencimiento_suscripcion = fecha_vencimiento_suscripcion;
        this.intentos_fallidos = intentos_fallidos;
        this.bloqueado_hasta = bloqueado_hasta;
        this.foto_url = foto_url;
    }
}

module.exports = Usuario;