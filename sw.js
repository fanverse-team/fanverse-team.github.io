// FANVERSE 離線支援：網站本身與場次資料「先連網、失敗才用快取」，所以永遠優先拿到最新版，沒網路時也能看已載入過的場次
const CACHE = 'fanverse-v3';
const CORE = ['./', './index.html', './styles.css', './concerts.json', './hotels.json', './arts.json', './venues.json', './privacy.html', './manifest.json', './icon-192.png'];
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

// 手機推播：Firebase Cloud Messaging 送來的通知
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { notification: { title: 'FANVERSE', body: e.data ? e.data.text() : '' } }; }
  const n = d.notification || d.data || {}, data = d.data || {};
  e.waitUntil(self.registration.showNotification(String(n.title || 'FANVERSE').slice(0, 60), { body: String(n.body || '').slice(0, 200), icon: './icon-192.png', badge: './icon-192.png', tag: data.tag || undefined, data: { url: data.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.location.origin);
  if (url.origin !== self.location.origin) return;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { for (const c of cs) if ('focus' in c) { c.navigate(url.href); return c.focus(); } return self.clients.openWindow(url.href); }));
});
