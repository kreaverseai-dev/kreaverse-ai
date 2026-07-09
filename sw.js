// Service Worker Minimalis untuk memicu PWA Install
self.addEventListener('install', (e) => {
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Membiarkan semua request berjalan normal (tidak di-cache agar web Anda tidak error)
    e.respondWith(fetch(e.request));
});