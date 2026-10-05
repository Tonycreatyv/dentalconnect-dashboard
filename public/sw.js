/* ConeXXion Admin PWA service worker.
   Fetch behavior remains network-first; push handling is isolated from WhatsApp flows. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "ConeXXion";
  const options = {
    body: payload.body || "Tenés una actualización que requiere atención.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag || undefined,
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.requireInteraction),
    data: {
      url: payload.url || "/operacion",
      notificationId: payload.notificationId || null,
      eventType: payload.eventType || null,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/operacion";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const absoluteTarget = new URL(targetUrl, self.location.origin).href;
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && "focus" in client) {
        if ("navigate" in client) await client.navigate(absoluteTarget);
        return client.focus();
      }
    }
    return self.clients.openWindow ? self.clients.openWindow(absoluteTarget) : undefined;
  })());
});
