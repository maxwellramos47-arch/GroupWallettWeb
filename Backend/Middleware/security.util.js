const crypto = require('crypto');
require('dotenv').config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; 
const HMAC_SECRET = process.env.HMAC_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;

function encriptarDatoSensible(textoPlano) {
    const iv = crypto.randomBytes(16); // Vector de inicialización único
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let encriptado = cipher.update(textoPlano, 'utf8', 'hex');
    encriptado += cipher.final('hex');
    return { iv: iv.toString('hex'), data: encriptado };
}

function desencriptarDatoSensible(encriptadoHex, ivHex) {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    let desencriptado = decipher.update(encriptadoHex, 'hex', 'utf8');
    desencriptado += decipher.final('utf8');
    return desencriptado;
}

function generarFirmaHMAC(datos) {
    return crypto.createHmac('sha256', HMAC_SECRET).update(datos).digest('hex');
}

module.exports = {
    encriptarDatoSensible,
    desencriptarDatoSensible,
    generarFirmaHMAC,
    JWT_SECRET
};