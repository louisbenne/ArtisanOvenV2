'use strict';
const CACHE = 'ao-admin-v1';
const PRECACHE = [
  '/admin/index.html',
  '/admin/orders.html',
  '/admin/kitchen.html',
  '/admin/events.html',
  '/admin/money.html',
  '/admin/comms.html',
  '/admin/settings.html',
  '/admin/login.html',
  '/admin/admin-shell.css',
  '/admin/admin-shell.js',
  '/frontend/style.css',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return; // Never cache API calls
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
