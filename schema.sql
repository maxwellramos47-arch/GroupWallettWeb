-- 1. Tabla de Planes de Suscripción (Modelo de Negocio SaaS)
CREATE TABLE IF NOT EXISTS Planes_Suscripcion (
    id_plan SERIAL PRIMARY KEY,
    nombre_plan VARCHAR(50) NOT NULL,
    precio DECIMAL(10, 2) NOT NULL,
    limite_grupos INT NOT NULL,
    beneficios TEXT
);

-- 2. Tabla de Usuarios
CREATE TABLE IF NOT EXISTS Usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    correo VARCHAR(150) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    id_plan INT DEFAULT 1,
    estado_suscripcion VARCHAR(20) DEFAULT 'activo',
    fecha_vencimiento_suscripcion DATE,
    reset_token VARCHAR(255),
    reset_token_expires TIMESTAMP,
    intentos_fallidos INT DEFAULT 0,
    bloqueado_hasta TIMESTAMP,
    foto_url VARCHAR(500),
    push_subscription TEXT,
    FOREIGN KEY (id_plan) REFERENCES Planes_Suscripcion(id_plan)
);

-- 3. Tabla de Grupos
CREATE TABLE IF NOT EXISTS Grupos (
    id_grupo SERIAL PRIMARY KEY,
    nombre_grupo VARCHAR(100) NOT NULL,
    id_usuario_creador INT NOT NULL,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario_creador) REFERENCES Usuarios(id_usuario)
);

-- 4. Tabla Intermedia: Miembros del Grupo (Relación N:M)
CREATE TABLE IF NOT EXISTS Miembros_Grupo (
    id_grupo INT NOT NULL,
    id_usuario INT NOT NULL,
    rol VARCHAR(20) DEFAULT 'Miembro',
    fecha_union TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_grupo, id_usuario),
    FOREIGN KEY (id_grupo) REFERENCES Grupos(id_grupo) ON DELETE CASCADE,
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario) ON DELETE CASCADE
);

-- 5. Tabla de Transacciones / Gastos
CREATE TABLE IF NOT EXISTS Transacciones (
    id_transaccion SERIAL PRIMARY KEY,
    id_grupo INT NOT NULL,
    id_usuario_pagador INT NOT NULL,
    monto DECIMAL(12, 2) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    categoria VARCHAR(100) DEFAULT 'General',
    comprobante_url VARCHAR(500),
    fecha_gasto TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    firma_hmac VARCHAR(255),
    FOREIGN KEY (id_grupo) REFERENCES Grupos(id_grupo) ON DELETE CASCADE,
    FOREIGN KEY (id_usuario_pagador) REFERENCES Usuarios(id_usuario)
);

-- 6. Tabla Intermedia: Participantes de la Transacción (Quiénes dividen el gasto)
CREATE TABLE IF NOT EXISTS Transaccion_Participantes (
    id_transaccion INT NOT NULL,
    id_usuario INT NOT NULL,
    estado_pago VARCHAR(20) DEFAULT 'Pendiente',
    PRIMARY KEY (id_transaccion, id_usuario),
    FOREIGN KEY (id_transaccion) REFERENCES Transacciones(id_transaccion) ON DELETE CASCADE,
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario) ON DELETE CASCADE
);

-- 7. Tabla de Métodos de Pago
CREATE TABLE IF NOT EXISTS Metodos_Pago (
    id_metodo SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL,
    tarjeta_encriptada TEXT NOT NULL,
    vector_inicializacion TEXT NOT NULL,
    fecha_agregado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario) ON DELETE CASCADE
);

-- 8. Tabla de Historial de Transacciones (Archivadas)
CREATE TABLE IF NOT EXISTS Transacciones_Historial (
    id_transaccion INT NOT NULL,
    id_grupo INT NOT NULL,
    id_usuario_pagador INT NOT NULL,
    monto DECIMAL(12, 2) NOT NULL,
    descripcion VARCHAR(255) NOT NULL,
    categoria VARCHAR(100) DEFAULT 'General',
    comprobante_url VARCHAR(500),
    fecha_gasto TIMESTAMP NOT NULL,
    firma_hmac VARCHAR(255),
    fecha_archivado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_transaccion)
);

-- 9. Tabla de Historial de Participantes (Archivadas)
CREATE TABLE IF NOT EXISTS Transaccion_Participantes_Historial (
    id_transaccion INT NOT NULL,
    id_usuario INT NOT NULL,
    estado_pago VARCHAR(20) NOT NULL,
    PRIMARY KEY (id_transaccion, id_usuario)
);

-- 10. Datos iniciales obligatorios
INSERT INTO Planes_Suscripcion (id_plan, nombre_plan, precio, limite_grupos, beneficios)
VALUES 
    (1, 'Básico', 0.00, 3, 'Acceso a 3 grupos gratis.'),
    (2, 'Premium', 5.00, 999, 'Grupos ilimitados y análisis de finanzas.')
ON CONFLICT (id_plan) DO NOTHING;

-- 11. Tabla de Tokens Revocados (Blacklist para Logout Seguro)
CREATE TABLE IF NOT EXISTS Tokens_Revocados (
    token VARCHAR(500) PRIMARY KEY,
    fecha_expiracion TIMESTAMP NOT NULL
);

-- 12. Tabla de Datos Bancarios (Para transferencias manuales)
CREATE TABLE IF NOT EXISTS Datos_Bancarios (
    id_dato SERIAL PRIMARY KEY,
    id_usuario INT UNIQUE NOT NULL,
    rut VARCHAR(20),
    banco VARCHAR(100),
    tipo_cuenta VARCHAR(50),
    numero_cuenta VARCHAR(50),
    correo VARCHAR(150),
    FOREIGN KEY (id_usuario) REFERENCES Usuarios(id_usuario) ON DELETE CASCADE
);

-- 13. Tabla de Transferencias Internas (Pagos dentro de la app con comisión)
CREATE TABLE IF NOT EXISTS Pagos_InApp (
    id_pago SERIAL PRIMARY KEY,
    id_transaccion INT NOT NULL,
    id_usuario_pagador INT NOT NULL,
    id_usuario_receptor INT NOT NULL,
    monto_original DECIMAL(12, 2) NOT NULL,
    comision DECIMAL(12, 2) NOT NULL,
    monto_final DECIMAL(12, 2) NOT NULL,
    fecha_pago TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario_pagador) REFERENCES Usuarios(id_usuario),
    FOREIGN KEY (id_usuario_receptor) REFERENCES Usuarios(id_usuario)
);