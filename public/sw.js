'use strict';

const CACHE_NAME = 'monika-shell-v3-20260713';
const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (
        request.method !== 'GET' ||
        url.origin !== self.location.origin ||
        url.pathname.startsWith('/api/') ||
        url.pathname === '/ask' ||
        url.pathname === '/api/ask/stream'
    ) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(async () => (await caches.match(request)) || caches.match('/index.html'))
        );
        return;
    }

    if (['/script.js', '/admin.js', '/style.css', '/manifest.json', '/sw.js'].includes(url.pathname)) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request).then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            });
            if (cached) {
                event.waitUntil(network.catch(() => undefined));
                return cached;
            }
            return network;
        })
    );
});

self.addEventListener('push', (event) => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch (_) { payload = { body: event.data?.text() || '' }; }
    event.waitUntil(self.registration.showNotification(payload.title || 'Monika AI 🌸', {
        body: payload.body || 'You have a new reminder.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: payload.reminderId ? `reminder-${payload.reminderId}` : 'monika-notification',
        renotify: false,
        data: { url: payload.url || '/' }
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).href;
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            const existing = clients.find((client) => client.url.startsWith(self.location.origin));
            if (existing) {
                existing.navigate(targetUrl);
                return existing.focus();
            }
            return self.clients.openWindow(targetUrl);
        })
    );
});
