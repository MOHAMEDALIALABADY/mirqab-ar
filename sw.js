// عامل خدمة بسيط: يحفظ ملفات التطبيق ليعمل في الموقع عند ضعف الشبكة.
const CACHE = 'mirqab-v2';
const FILES = ['./', 'index.html', 'app.js', 'geo.js', 'parsers.js', 'models.js', 'manifest.json', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/three.module.min.js', 'vendor/proj4.js', 'vendor/shp.js', 'vendor/fflate.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // الشبكة أولاً لتصل التحديثات، ثم النسخة المحفوظة عند انقطاع الاتصال
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
