// Guarda la app en el iPhone para que abra al instante y sin conexión.
// Las consultas a Wallapop no se guardan: siempre van a Internet.
const CACHE = "compraventa-1.1.0";
const ARCHIVOS = ["./", "index.html", "app.css", "movil.css", "app.js", "motor.js", "config.json", "icono.svg",
  "apple-touch-icon.png", "icono-192.png", "icono-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  // Primero la red (para recibir actualizaciones); si no hay conexión, la copia guardada.
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
