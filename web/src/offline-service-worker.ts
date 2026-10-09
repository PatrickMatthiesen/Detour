const offlineRoutes = ["/", "/plan", "/preparation", "/itinerary"];
const publicShellAssets = [
  "/icons/detour-32.png",
  "/icons/detour-192.png",
  "/icons/detour-180.png",
];

/** Build the production worker source from paths emitted by Vite. */
export function createOfflineServiceWorker(assets: string[], version: string): string {
  const precache = [...new Set(["/", "/index.html", ...publicShellAssets, ...assets])].sort();
  return `const CACHE_PREFIX = "detour-app-shell-";
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(version)};
const PRECACHE_URLS = ${JSON.stringify(precache)};
const APP_ROUTES = new Set(${JSON.stringify(offlineRoutes)});
const PRECACHED_ASSETS = new Set(PRECACHE_URLS.map((path) => new URL(path, self.location.origin).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE_URLS);
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (!APP_ROUTES.has(url.pathname)) return;
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        return await fetch(request);
      } catch {
        return await cache.match(new Request(new URL("/index.html", self.location.origin))) || Response.error();
      }
    })());
    return;
  }

  if (!PRECACHED_ASSETS.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Static servers may vary cross-origin module requests by Origin. The
    // asset path is build-allowlisted, so the same bundled bytes are safe to
    // reuse even when cache.addAll and the browser request vary by Origin.
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    return fetch(request);
  })());
});
`;
}
