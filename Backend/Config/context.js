const { AsyncLocalStorage } = require('async_hooks');

// Almacén asíncrono para mantener el contexto del usuario a lo largo de la petición HTTP
const requestContext = new AsyncLocalStorage();

module.exports = requestContext;