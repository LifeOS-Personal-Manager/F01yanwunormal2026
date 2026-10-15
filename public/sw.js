const CACHE_NAME = "yanwu-shell-v2";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("yanwu-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.origin !== self.location.origin) return;
  const navigation = event.request.mode === "navigate";
  const shellAsset = requestUrl.pathname.startsWith("/assets/") || SHELL.includes(requestUrl.pathname);
  // API responses and attachments must never be stored in the offline shell.
  if (requestUrl.pathname.startsWith("/api/") || (!navigation && !shellAsset)) return;
  event.respondWith(
    fetch(event.request, { cache: navigation ? "reload" : "default" })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        if (navigation) {
          const shell = await cache.match("/");
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});

