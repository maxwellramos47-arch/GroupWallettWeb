const CACHE_NAME = 'groupwallet-v2';
const ASSETS_TO_CACHE = [
    '/',
    '/dashboard.html',
    '/mensual.html',
    '/styles.css',
    '/app.js',
    '/mensual.js'
];

// Instalación: Guardar los archivos estáticos en caché
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
    );
});

// Activación: Eliminar cachés antiguos para forzar la actualización del código
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        })
    );
});

// Intercepción de peticiones: Servir desde caché si está disponible
self.addEventListener('fetch', (event) => {
    // Excluir peticiones dinámicas (API, Storage en la nube) del caché estático
    if (event.request.url.includes('/api/') || event.request.url.includes('supabase.co') || event.request.url.includes('s3.amazonaws.com')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => response || fetch(event.request))
    );
});

// Escuchar notificaciones Push del Backend
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : { title: 'Notificación', body: 'Tienes un nuevo mensaje.', url: '/' };
    const options = {
        body: data.body,
        icon: 'icon-192x192.png',
        vibrate: [300, 100, 300, 100, 300], // Patrón de vibración fuerte (3 toques)
        data: { url: data.url }
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(clients.openWindow(event.notification.data.url));
});