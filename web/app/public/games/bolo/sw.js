// Service worker for the Bolo (Orona) PWA.
//
// Orona's client is a ~221 KB esbuild bundle plus vendored jQuery/jQuery-UI and
// the original Bolo tilemaps + .ogg sounds. None of these carry cache-control
// headers, so we store them in Cache Storage and serve them cache-first — the
// game then loads instantly after the first visit and works fully offline.
// Bump CACHE whenever the bundle or assets are rebuilt.
const CACHE = "bolo-v1";
const SHELL = [
  "./play.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./js/bolo-bundle.js",
  "./js/jquery.cookie.js",
  "./vendor/jquery-3.7.1.min.js",
  "./vendor/jquery-ui-1.13.2.min.js",
  "./vendor/jquery-ui-1.13.2.min.css",
  "./css/bolo.css",
  "./css/jquery.ui.theme.css",
  "./images/base.png",
  "./images/styled.png",
  "./images/overlay.png",
  "./images/hud.png",
  "./images/favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {}) // shell precache is best-effort
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.includes("/games/bolo/")) return;
  if (url.pathname.endsWith("/sw.js")) return; // never let the SW cache itself

  // HTML shell: network-first so updates flow; fall back to cache when offline.
  if (url.pathname.endsWith(".html") || url.pathname.endsWith("/games/bolo/")) {
    event.respondWith(networkFirst(req));
    return;
  }
  // Bundle + media assets (js/css/png/ogg/manifest): cache-first.
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const resp = await fetch(req);
  if (resp && resp.status === 200 && resp.type === "basic") {
    cache.put(req, resp.clone()).catch(() => {}); // ignore quota errors
  }
  return resp;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await fetch(req);
    if (resp && resp.status === 200) cache.put(req, resp.clone()).catch(() => {});
    return resp;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}
