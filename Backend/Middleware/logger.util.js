const fs = require('fs');
const path = require('path');

function logError(context, error) {
    const timestamp = new Date().toISOString();
    const errorMessage = error.stack || error.message || error;
    const logEntry = `[${timestamp}] ERROR en [${context}]:\n${errorMessage}\n=========================================\n`;
    
    // Imprimir en la consola para desarrollo (en color rojo)
    console.error(`\x1b[31m[ERROR - ${context}]\x1b[0m ${error.message || error}`);
    
    // Guardar físicamente en un archivo 'error.log' en la raíz del proyecto
    const logFilePath = path.join(__dirname, '../../error.log');
    fs.appendFileSync(logFilePath, logEntry, 'utf8');
}

module.exports = { logError };