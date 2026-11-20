/* =============================================================================
 * E-mergency Service Worker
 * Offline-first app shell. An emergency app has to open when the network does
 * not, so every asset the UI needs is precached at install time and served from
 * cache first; updates are fetched in the background and the page is told when
 * a new version is ready.
 * ========================================================================== */

const VERSION = 'v1.0.0';
const SHELL_CACHE = `emergency-shell-${VERSION}`;
const RUNTIME_CACHE = `emergency-runtime-${VERSION}`;

// Everything required to boot the app with no network at all.
const PRECACHE_URLS = [
  "./",
  "index.html",
  "offline.html",
  "manifest.webmanifest",
  "assets/app.css",
  "assets/lucide.min.js",
  "assets/fonts/inter-latin-ext.woff2",
  "assets/fonts/inter-latin.woff2",
  "assets/fonts/jetbrains-mono-latin-ext.woff2",
  "assets/fonts/jetbrains-mono-latin.woff2",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "icons/shortcut-blotter.png",
  "icons/shortcut-command.png",
  "icons/shortcut-sos.png"
];

// ---------------------------------------------------------------------------
// Install: precache the shell. Individual adds so one bad URL cannot abort all.
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const results = await Promise.allSettled(
      PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    const failed = results
      .map((r, i) => (r.status === 'rejected' ? PRECACHE_URLS[i] : null))
      .filter(Boolean);
    if (failed.length) console.warn('[E-mergency SW] Not precached:', failed);
  })());
});

// ---------------------------------------------------------------------------
// Activate: drop caches from older versions and take control immediately.
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

// ---------------------------------------------------------------------------
// Fetch strategies
//   navigations      -> cache-first (instant launch) + background revalidate
//   same-origin GETs -> stale-while-revalidate
//   anything else    -> straight to network
// ---------------------------------------------------------------------------
function revalidate(request, cacheName) {
  return fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(cacheName).then((cache) => cache.put(request, copy));
      }
      return response;
    })
    .catch(() => null);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('index.html')
                  || await caches.match('./');
      if (cached) {
        event.waitUntil(revalidate(new Request('index.html'), SHELL_CACHE));
        return cached;
      }
      try {
        const preloaded = await event.preloadResponse;
        return preloaded || await fetch(request);
      } catch (err) {
        return (await caches.match('offline.html'))
            || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      event.waitUntil(revalidate(request, RUNTIME_CACHE));
      return cached;
    }
    const fresh = await revalidate(request, RUNTIME_CACHE);
    if (fresh) return fresh;
    return new Response('', { status: 504, statusText: 'Offline and not cached' });
  })());
});

// ---------------------------------------------------------------------------
// Page -> SW messages
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'GET_VERSION') {
    event.source && event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
});

// ---------------------------------------------------------------------------
// Background Sync: when connectivity returns, wake any open page so it can
// transmit SOS reports that were queued while the device was offline.
// ---------------------------------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag !== 'emergency-sos-sync') return;
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true
    });
    clientList.forEach((client) => client.postMessage({ type: 'FLUSH_SOS_QUEUE' }));
  })());
});
