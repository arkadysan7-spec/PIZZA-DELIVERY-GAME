// שומר עותק של האפליקציה בטלפון, כדי שתיפתח גם בלי קליטה.
// דפים: קודם מהרשת (כדי לקבל עדכונים), ואם אין רשת – מהעותק השמור.
// תמונות וגופנים: מהעותק השמור, ומתעדכנים ברקע.
const CACHE = 'p4p-v4';
const CORE = ['./', 'index.html', 'ninja.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // מוזיקה/וידאו – משאירים לדפדפן (בקשות חלקיות של אודיו נשברות דרך service worker באייפון)
  if (req.destination === 'audio' || req.destination === 'video' || /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(req.url)) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
