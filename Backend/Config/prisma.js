const { PrismaClient } = require('@prisma/client');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Ensamblamos la URL dinámicamente usando las variables que ya existen en tu .env
const dbUser = process.env.DB_USER || 'postgres';
const dbPass = encodeURIComponent(process.env.DB_PASSWORD || '');
const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || '5432';
const dbName = process.env.DB_DATABASE || 'groupwallet';

const dbUrl = process.env.DATABASE_URL || `postgresql://${dbUser}:${dbPass}@${dbHost}:${dbPort}/${dbName}?schema=public`;

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: dbUrl
        }
    }
});

module.exports = prisma;