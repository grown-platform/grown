// Service worker for the Mighty Mike PWA.
//
// The engine assets (MightyMike.wasm ~2 MB, MightyMike.data ~15 MB) are served
// without cache-control headers, so the browser re-downloads them on every
// launch. Here we store them in Cache Storage — which is persistent and far
// larger than the HTTP cache, especially for an installed PWA — and serve them
// cache-first, so the game loads instantly after the first visit and works
// offline. Bump CACHE whenever the game assets are rebuilt.
const CACHE = "mightymike-v2";
const SHELL = [
  "./play.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
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
  if (!url.pathname.includes("/games/mightymike/")) return;
  if (url.pathname.endsWith("/sw.js")) return; // never let the SW cache itself

  // HTML shell: network-first so updates flow; fall back to cache when offline.
  if (url.pathname.endsWith(".html") || url.pathname.endsWith("/games/mightymike/")) {
    event.respondWith(networkFirst(req));
    return;
  }
  // Engine + media assets (wasm/data/js/png/manifest): cache-first.
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const resp = await fetch(req);
  // Only cache full (200) same-origin responses; skip partial/opaque ones.
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
