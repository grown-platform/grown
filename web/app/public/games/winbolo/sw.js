// Service worker for the WinBolo PWA: cache-first for the engine (wasm/data/js),
// network-first for the HTML shell so updates flow. Bump CACHE on rebuild.
const CACHE = "winbolo-v1";
const SHELL = ["./play.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./Bolo.js","./Bolo.wasm","./Bolo.data"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))); });
self.addEventListener("activate", (e) => e.waitUntil((async () => { const ks = await caches.keys(); await Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))); await self.clients.claim(); })()));
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isHTML) { e.respondWith(fetch(req).then((r) => { caches.open(CACHE).then((c) => c.put(req, r.clone())); return r; }).catch(() => caches.match(req).then((r) => r || caches.match("./play.html")))); return; }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); } return r; })));
});
