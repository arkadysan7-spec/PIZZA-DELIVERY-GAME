// App-shell service worker: offline UI, network-first for the API.
const VERSION = 'v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/db.js', '/sketch.js', '/manifest.webmanifest',
  '/icons/icon-192.png', '/icons/icon-512.png', '/demo/walkin.svg', '/demo/niche.svg', '/demo/door.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // always network (catalog is cached in localStorage by the app)
  // stale-while-revalidate for the shell
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => cached);
    return cached || net;
  }));
});
