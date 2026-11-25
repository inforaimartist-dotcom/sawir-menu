// säwir menu: the page and photos are kept on the tablet so the menu works without Wi-Fi
const CACHE = 'sawir-menu-v1';
const SHELL = ['./', 'manifest.webmanifest', 'icon-192.png', 'img/logo.png'];
const PAGE_WAIT_MS = 4000; // Wi-Fi with no internet: show the saved menu instead of a blank screen

self.addEventListener('install', e => {
  // save the page itself right away, so the very first reload without Wi-Fi still opens the menu
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .catch(() => {})
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

async function savedPage(req) {
  const c = await caches.open(CACHE);
  return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || (await c.match('./'));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('version.json')) return; // always ask the server
  if (/\.(webp|png|jpg|jpeg|woff2?)$/.test(url.pathname)) {
    // photos: from the tablet first, the network only for new ones
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html') || url.pathname.endsWith('.webmanifest')) {
    // the page: fresh from the network; the saved copy when offline or when the network hangs
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    });
    e.waitUntil(net.catch(() => {}));
    e.respondWith(new Promise(resolve => {
      let done = false;
      const useSaved = async () => {
        const saved = await savedPage(req);
        if (saved && !done) { done = true; resolve(saved); }
        return !!saved;
      };
      const timer = setTimeout(useSaved, PAGE_WAIT_MS);
      net.then(async res => {
          clearTimeout(timer);
          if (!res.ok && res.status >= 500 && await useSaved()) return; // server trouble: keep the saved menu
          if (!done) { done = true; resolve(res); }
        })
        .catch(async () => {
          clearTimeout(timer);
          if (!(await useSaved()) && !done) { done = true; resolve(Response.error()); }
        });
    }));
  }
});
