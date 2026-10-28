// Alt hentes fra nett først, så nye versjoner vises med én gang; cachen brukes bare offline.
// Lydklipp og video lagres ikke.
const VERSION = "v4";
const SHELL = ["./", "index.html", "style.css", "app.js", "skann.js", "manifest.webmanifest", "icons/icon.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // no-cache: spør serveren om filen er endret i stedet for å stole på nettleserens HTTP-cache (GitHub Pages: 10 min)
  e.respondWith(fetch(url.href, { cache: "no-cache" }).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
