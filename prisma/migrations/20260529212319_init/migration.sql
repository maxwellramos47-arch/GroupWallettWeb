-- CreateTable
CREATE TABLE "planes_suscripcion" (
    "id_plan" SERIAL NOT NULL,
    "nombre_plan" VARCHAR(50) NOT NULL,
    "precio" DECIMAL(10,2) NOT NULL,
    "limite_grupos" INTEGER NOT NULL,
    "beneficios" TEXT,

    CONSTRAINT "planes_suscripcion_pkey" PRIMARY KEY ("id_plan")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id_usuario" SERIAL NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "correo" VARCHAR(150) NOT NULL,
    "telefono" VARCHAR(20),
    "password_hash" VARCHAR(255) NOT NULL,
    "fecha_registro" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "id_plan" INTEGER DEFAULT 1,
    "estado_suscripcion" BOOLEAN NOT NULL DEFAULT false,
    "fecha_vencimiento_suscripcion" DATE,
    "reset_token" VARCHAR(255),
    "reset_token_expires" TIMESTAMP,
    "intentos_fallidos" INTEGER DEFAULT 0,
    "bloqueado_hasta" TIMESTAMP,
    "foto_url" VARCHAR(500),
    "push_subscription" TEXT,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id_usuario")
);

-- CreateTable
CREATE TABLE "grupos" (
    "id_grupo" SERIAL NOT NULL,
    "nombre_grupo" VARCHAR(100) NOT NULL,
    "id_usuario_creador" INTEGER NOT NULL,
    "fecha_creacion" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grupos_pkey" PRIMARY KEY ("id_grupo")
);

-- CreateTable
CREATE TABLE "miembros_grupo" (
    "id_grupo" INTEGER NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "rol" VARCHAR(20) DEFAULT 'Miembro',
    "fecha_union" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "miembros_grupo_pkey" PRIMARY KEY ("id_grupo","id_usuario")
);

-- CreateTable
CREATE TABLE "transacciones" (
    "id_transaccion" SERIAL NOT NULL,
    "id_grupo" INTEGER NOT NULL,
    "id_usuario_pagador" INTEGER NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "descripcion" VARCHAR(255) NOT NULL,
    "categoria" VARCHAR(100) DEFAULT 'General',
    "comprobante_url" VARCHAR(500),
    "fecha_gasto" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "firma_hmac" VARCHAR(255),

    CONSTRAINT "transacciones_pkey" PRIMARY KEY ("id_transaccion")
);

-- CreateTable
CREATE TABLE "transaccion_participantes" (
    "id_transaccion" INTEGER NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "estado_pago" VARCHAR(20) DEFAULT 'Pendiente',

    CONSTRAINT "transaccion_participantes_pkey" PRIMARY KEY ("id_transaccion","id_usuario")
);

-- CreateTable
CREATE TABLE "metodos_pago" (
    "id_metodo" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "tarjeta_encriptada" TEXT NOT NULL,
    "vector_inicializacion" TEXT NOT NULL,
    "fecha_agregado" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metodos_pago_pkey" PRIMARY KEY ("id_metodo")
);

-- CreateTable
CREATE TABLE "transacciones_historial" (
    "id_transaccion" INTEGER NOT NULL,
    "id_grupo" INTEGER NOT NULL,
    "id_usuario_pagador" INTEGER NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "descripcion" VARCHAR(255) NOT NULL,
    "categoria" VARCHAR(100) DEFAULT 'General',
    "comprobante_url" VARCHAR(500),
    "fecha_gasto" TIMESTAMP NOT NULL,
    "firma_hmac" VARCHAR(255),
    "fecha_archivado" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transacciones_historial_pkey" PRIMARY KEY ("id_transaccion")
);

-- CreateTable
CREATE TABLE "transaccion_participantes_historial" (
    "id_transaccion" INTEGER NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "estado_pago" VARCHAR(20) NOT NULL,

    CONSTRAINT "transaccion_participantes_historial_pkey" PRIMARY KEY ("id_transaccion","id_usuario")
);

-- CreateTable
CREATE TABLE "tokens_revocados" (
    "token" VARCHAR(500) NOT NULL,
    "fecha_expiracion" TIMESTAMP NOT NULL,

    CONSTRAINT "tokens_revocados_pkey" PRIMARY KEY ("token")
);

-- CreateTable
CREATE TABLE "pagos_inapp" (
    "id_pago" SERIAL NOT NULL,
    "id_transaccion" INTEGER NOT NULL,
    "id_usuario_pagador" INTEGER NOT NULL,
    "id_usuario_receptor" INTEGER NOT NULL,
    "monto_original" DECIMAL(12,2) NOT NULL,
    "comision" DECIMAL(12,2) NOT NULL,
    "monto_final" DECIMAL(12,2) NOT NULL,
    "fecha_pago" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_inapp_pkey" PRIMARY KEY ("id_pago")
);

-- CreateTable
CREATE TABLE "datos_bancarios" (
    "id_dato" SERIAL NOT NULL,
    "id_usuario" INTEGER NOT NULL,
    "rut" VARCHAR(20),
    "banco" VARCHAR(100),
    "tipo_cuenta" VARCHAR(50),
    "numero_cuenta" VARCHAR(50),
    "correo" VARCHAR(150),

    CONSTRAINT "datos_bancarios_pkey" PRIMARY KEY ("id_dato")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "datos_bancarios_id_usuario_key" ON "datos_bancarios"("id_usuario");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_id_plan_fkey" FOREIGN KEY ("id_plan") REFERENCES "planes_suscripcion"("id_plan") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grupos" ADD CONSTRAINT "grupos_id_usuario_creador_fkey" FOREIGN KEY ("id_usuario_creador") REFERENCES "usuarios"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miembros_grupo" ADD CONSTRAINT "miembros_grupo_id_grupo_fkey" FOREIGN KEY ("id_grupo") REFERENCES "grupos"("id_grupo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miembros_grupo" ADD CONSTRAINT "miembros_grupo_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuarios"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_id_grupo_fkey" FOREIGN KEY ("id_grupo") REFERENCES "grupos"("id_grupo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transacciones" ADD CONSTRAINT "transacciones_id_usuario_pagador_fkey" FOREIGN KEY ("id_usuario_pagador") REFERENCES "usuarios"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaccion_participantes" ADD CONSTRAINT "transaccion_participantes_id_transaccion_fkey" FOREIGN KEY ("id_transaccion") REFERENCES "transacciones"("id_transaccion") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaccion_participantes" ADD CONSTRAINT "transaccion_participantes_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuarios"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metodos_pago" ADD CONSTRAINT "metodos_pago_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuarios"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_inapp" ADD CONSTRAINT "pagos_inapp_id_usuario_pagador_fkey" FOREIGN KEY ("id_usuario_pagador") REFERENCES "usuarios"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_inapp" ADD CONSTRAINT "pagos_inapp_id_usuario_receptor_fkey" FOREIGN KEY ("id_usuario_receptor") REFERENCES "usuarios"("id_usuario") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datos_bancarios" ADD CONSTRAINT "datos_bancarios_id_usuario_fkey" FOREIGN KEY ("id_usuario") REFERENCES "usuarios"("id_usuario") ON DELETE CASCADE ON UPDATE CASCADE;

-- Desactivar RLS por seguridad en entornos donde el usuario lo requiera explicitamente
ALTER TABLE "planes_suscripcion" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "usuarios" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "grupos" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "miembros_grupo" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "transacciones" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "transaccion_participantes" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "metodos_pago" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "transacciones_historial" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "transaccion_participantes_historial" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "tokens_revocados" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "pagos_inapp" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "datos_bancarios" DISABLE ROW LEVEL SECURITY;
