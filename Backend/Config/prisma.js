const { PrismaClient } = require('@prisma/client');
const path = require('path');
const requestContext = require('./context');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Ensamblamos la URL dinámicamente usando las variables que ya existen en tu .env
const dbUser = process.env.DB_USER || 'postgres';
const dbPass = encodeURIComponent(process.env.DB_PASSWORD || '');
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || '5432';
const dbName = process.env.DB_DATABASE || 'groupwallet';

const dbUrl = process.env.DATABASE_URL || `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}?schema=public`;

const basePrisma = new PrismaClient({
    datasources: {
        db: {
            url: dbUrl
        }
    }
});

// Prisma Client Extension para habilitar RLS (Row-Level Security) nativo en Postgres
const prisma = basePrisma.$extends({
    query: {
        $allModels: {
            async $allOperations({ args, query }) {
                const context = requestContext.getStore();
                
                // Si hay un usuario en contexto (Petición HTTP autenticada) y NO es Súper Admin
                if (context && context.userId && !context.bypassRLS) {
                    // Usamos una transacción para asegurar que el set_config y el query 
                    // se ejecuten en la misma conexión segura del pool
                    const [, result] = await basePrisma.$transaction([
                        basePrisma.$executeRaw`SELECT set_config('app.current_user_id', ${context.userId}, TRUE)`,
                        query(args)
                    ]);
                    return result;
                }
                
                // Procesos en segundo plano (Cron Jobs) o Súper Admins ejecutan normalmente
                return query(args);
            }
        }
    }
});

module.exports = prisma;