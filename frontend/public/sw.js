/* Pydah Transport app-shell service worker */
const CACHE = 'pydah-transport-shell-v11';
const PRECACHE = [
  '/',
  '/index.html',
  '/verify',
  '/login',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/Gemini_Generated_Image_uu0hhduu0hhduu0h.png',
];

const offlineFallback = () =>
  new Response('<!doctype html><title>Offline</title><h1>Offline</h1>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses
  if (url.pathname.startsWith('/api') || url.pathname.includes('/api/')) {
    return;
  }

  // Hashed JS/CSS: network-first so camera fixes reach phones (avoid stale app shell)
  const isVersionedAsset = /\.(?:js|css)$/i.test(url.pathname) || url.pathname.startsWith('/assets/');

  // SPA navigation + versioned assets: prefer network when online
  if (request.mode === 'navigate' || isVersionedAsset) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            const cacheKey = request.mode === 'navigate' ? '/index.html' : request;
            caches.open(CACHE).then((cache) => cache.put(cacheKey, clone));
          }
          return response;
        })
        .catch(async () => {
          if (request.mode === 'navigate') {
            const cached = (await caches.match('/index.html')) || (await caches.match('/'));
            return cached || offlineFallback();
          }
          return (await caches.match(request)) || offlineFallback();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached || offlineFallback());

      return cached || network;
    }).catch(() => offlineFallback())
  );
});
