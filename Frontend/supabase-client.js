// supabase-client.js

// Este archivo inicializa el cliente de Supabase para que esté disponible
// en toda la aplicación frontend de forma segura.

// Creamos un objeto global para nuestra aplicación si no existe
window.groupWallet = window.groupWallet || {};

(async () => {
    try {
        // 1. Pedimos las claves públicas al backend
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('No se pudo obtener la configuración del servidor.');
        
        const config = await response.json();

        if (config.supabaseUrl && config.supabaseKey) {
            // 2. Usamos las claves para crear el cliente de Supabase
            // Nota: La librería de Supabase debe estar incluida en el HTML.
            window.groupWallet.supabase = supabase.createClient(config.supabaseUrl, config.supabaseKey);
            console.log('Cliente de Supabase inicializado exitosamente.');
        }
    } catch (error) {
        console.error('Error inicializando Supabase:', error);
    }
})();