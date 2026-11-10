const CACHE = 'clap-v27';
const EXT = 'nw-ext';
const SHELL = ['./', 'index.html', 'clap.js', 'clap-plus.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== EXT).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Images demandées en CORS (bilan en canvas) : on laisse passer, le cache ne contient que des réponses opaques
  if (req.mode === 'cors' && url.hostname === 'image.tmdb.org') return;

  // Fichiers de l'appli : réseau d'abord (mises à jour), cache en secours (hors-ligne)
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })
        .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
    );
    return;
  }

  // Affiches TMDB + Chart.js : cache d'abord
  if (url.hostname === 'image.tmdb.org' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.open(EXT).then(async c => {
        const hit = await c.match(req);
        if (hit) return hit;
        try { const r = await fetch(req); c.put(req, r.clone()); return r; }
        catch { return hit || Response.error(); }
      })
    );
  }
  // L'API TMDB passe directement par le réseau
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => 'focus' in w);
    return c ? c.focus() : self.clients.openWindow('./');
  }));
});
