/*
 * App-shell cache, keyed by app version.
 *
 * The version arrives as a query parameter on the registration URL rather
 * than being hardcoded here. That means a new release changes the service
 * worker's own URL, which is what makes the browser fetch and install it —
 * and it keeps the cache name in step with the build automatically, so a
 * deploy can never leave someone staring at an old bundle while the header
 * claims a new version.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `swinglab-${VERSION}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add('./')));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  /*
   * Network-first for navigations, cache-first for assets.
   *
   * Assets are content-hashed so they are safe to serve from cache forever,
   * but the HTML entry point is not — serving that from cache first is
   * exactly how a PWA pins itself to an old release.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit ?? caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return response;
        }),
    ),
  );
});
