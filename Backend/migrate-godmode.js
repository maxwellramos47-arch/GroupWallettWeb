const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Verificando existencia del Plan Admin (ID: 3)...');
    
    // Usar query raw para saltar la restricción de Prisma sobre la inserción manual en un campo autoincrement
    await prisma.$executeRaw`
        INSERT INTO planes_suscripcion (id_plan, nombre_plan, precio, limite_grupos, limite_miembros_por_grupo, beneficios)
        VALUES (3, 'Admin', 0.00, 999, 999, 'Administrador global del sistema.')
        ON CONFLICT (id_plan) DO NOTHING
    `;

    console.log('🔄 Iniciando migración de usuarios GOD_MODE al nuevo id_plan = 3...');
    
    const result = await prisma.usuarios.updateMany({
        where: { estado_suscripcion: 'GOD_MODE' },
        data: { id_plan: 3, estado_suscripcion: 'activo' }
    });
    
    console.log(`✅ Migración completada exitosamente.`);
    console.log(`👤 Usuarios actualizados al nuevo Plan Admin: ${result.count}`);
}

main()
    .catch(e => { console.error('❌ Error crítico en la migración:', e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });