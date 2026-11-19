// FANVERSE 離線支援：網站本身與場次資料「先連網、失敗才用快取」，所以永遠優先拿到最新版，沒網路時也能看已載入過的場次
const CACHE = 'fanverse-v1';
const CORE = ['./', './index.html', './styles.css', './concerts.json', './hotels.json', './privacy.html', './manifest.json', './icon-192.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(() => { })).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // 只處理本站的 GET；登入、資料庫、Google 服務一律直接連網，不經過快取
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
