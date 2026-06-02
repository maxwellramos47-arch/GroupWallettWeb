const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Verificando existencia del Plan Admin (ID: 3)...');
    
    await prisma.planes_Suscripcion.upsert({
        where: { id_plan: 3 },
        update: {},
        create: {
            id_plan: 3,
            nombre_plan: 'Admin',
            precio: 0.00,
            limite_grupos: 999,
            limite_miembros_por_grupo: 999,
            beneficios: 'Administrador global del sistema.'
        }
    });

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