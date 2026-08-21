// Offline service worker (SPEC §12).
//
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ THE DOCUMENT IS NETWORK-FIRST. THE HASHED ASSETS ARE CACHE-FIRST.
// ════════════════════════════════════════════════════════════════════════════
//
// This used to be cache-first for EVERY same-origin GET — `return cached ||
// network`, with the network response only refreshing the cache for next time.
// That is right for a hashed asset and wrong for `index.html`, and the
// difference is not academic:
//
// Vite emits `assets/index-<hash>.js`, and `index.html` is the only thing that
// says WHICH hash. Serving a cached document therefore pins the whole app to
// the bundle it shipped with. A phone that had opened the app once kept running
// week-old code, and only picked up a deploy on a SECOND load — which nobody
// does, because the app looked like it had loaded fine.
//
// What that cost, concretely: a phone stuck on the pre-2026-08-19 bundle still
// had the `date.getTime` bug, so every repeating task failed to reach Google and
// only one-offs appeared. Worse, it predated the GS-8 library gate, so it would
// happily push its own starter buckets over the real library — the exact
// data-loss path that gate exists to close. **A guard only protects the devices
// actually running it**, and a stale-forever cache means some device is not.
//
// So: the document is fetched from the network and only falls back to the cache
// when genuinely offline. Hashed assets keep cache-first, which is safe because
// their names change when their contents do — that is what the hash is for.
const CACHE = 'sandy-cay-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

/** Is this the app document rather than one of its fingerprinted assets? */
function isDocument(request) {
  if (request.mode === 'navigate') return true;
  const path = new URL(request.url).pathname;
  return path.endsWith('/') || path.endsWith('.html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (isDocument(request)) {
    // Network first. A stale document pins a stale app; a slow one only costs
    // a moment, and being offline still falls back to what we have.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) || Response.error()),
    );
    return;
  }

  // Everything else — hashed assets, icons, the manifest. Cache-first is right
  // here: a fingerprinted name cannot go stale, because a change renames it.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
