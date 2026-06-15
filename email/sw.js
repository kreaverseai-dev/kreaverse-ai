self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Menangani event klik pada notifikasi push
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    // Saat notifikasi di-klik, arahkan user kembali ke halaman email (atau fokuskan tab jika sudah terbuka)
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((windowClients) => {
            for (let client of windowClients) {
                if (client.url.includes('/email') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/email/');
            }
        })
    );
});