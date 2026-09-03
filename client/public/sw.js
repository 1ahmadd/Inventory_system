/* عامل الخدمة — تخزين مؤقت لتمكين التثبيت كتطبيق (PWA) والعمل السريع */
const CACHE_NAME = "field-ledger-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/assets/logo.png",
  "/assets/empty-state.png",
  "/assets/paper-texture.png",
  "/assets/icons/icon-180.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => undefined)
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // لا نخزن طلبات المصادقة أو أي طلب غير GET
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return response;
          })
          .catch(() => caches.match("/index.html"))
    )
  );
});
