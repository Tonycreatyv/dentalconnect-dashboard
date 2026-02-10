/* Basic SW placeholder for PWA (safe minimal) */
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Network-first fetch (no caching yet; keeps behavior simple)
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
