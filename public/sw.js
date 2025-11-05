/*
 * Service worker for EZ Quiz Web
 *
 * This service worker caches the core assets of the site, enabling offline
 * functionality. During the install phase, it caches the app shell; during
 * activation it cleans up any old caches. The fetch handler implements a
 * cache‑first strategy with a network fallback, returning the cached index
 * page for navigation requests when offline.
 */

const ASSET_VERSION = '1.5.23';
const CACHE_NAME = 'ezq-v1207';
const PRECACHE_URLS = [
  '/index.html',
  '/styles.css?v=' + ASSET_VERSION,
  '/styles.tokens.css?v=' + ASSET_VERSION,
  '/styles.backdrop.css?v=' + ASSET_VERSION,
  '/js/theme-preload.js?v=' + ASSET_VERSION,
  '/js/boot-beta.js?v=' + ASSET_VERSION,
  '/js/main.js?v=' + ASSET_VERSION,
  '/js/auto-refresh.js?v=' + ASSET_VERSION,
  '/js/patches.js?v=' + ASSET_VERSION,
  '/js/editor.gui.js?v=' + ASSET_VERSION,
  '/js/generator.js?v=' + ASSET_VERSION,
  '/js/generator-payload.js?v=' + ASSET_VERSION,
  '/js/a11y-announcer.js?v=' + ASSET_VERSION,
  '/js/api.js?v=' + ASSET_VERSION,
  '/manifest.webmanifest',
  '/sw.js',
  // Module graph (unversioned dependencies imported within versioned entry points)
  '/js/state.js',
  '/js/utils.js',
  '/js/parser.js',
  '/js/veil.js',
  '/js/settings.js',
  '/js/modals.js',
  '/js/quiz.js',
  '/js/beta.mjs',
  '/js/import-controller.js',
  '/js/file-type-validation.js',
  '/js/drag-drop.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/brand-title-source.png',
  '/icons/brand-title-source-light.png',
  '/icons/favicon.ico',
  '/icons/favicon-16.png',
  '/icons/favicon-32.png'
];
const URLS_TO_CACHE = PRECACHE_URLS.map((p) => new URL(p, self.registration.scope).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Optional control messages for instant activation/cache clear
self.addEventListener('message', (event) => {
  const msg = event && event.data;
  if (msg === 'SKIP_WAITING') self.skipWaiting();
  if (msg === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle http/https requests; ignore extension and data schemes
  let url;
  try {
    url = new URL(req.url);
    const proto = url.protocol;
    if (proto !== 'http:' && proto !== 'https:') return;
  } catch { return; }
  if (req.url.includes('/.netlify/functions/')) return; // let network handle serverless calls
  if (req.method !== 'GET') return;

  // Cache-first for versioned assets (anything with ?v=)
  if (url.searchParams.has('v')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req, { cache: 'no-store' });
      try {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      } catch {}
      return fresh;
    })());
    return;
  }

  // Network-first for navigations (guarantee fresh HTML when online)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        try {
          const cache = await caches.open(CACHE_NAME);
          const indexUrl = new URL('/index.html', self.registration.scope).toString();
          cache.put(indexUrl, fresh.clone());
        } catch {}
        return fresh;
      } catch (e) {
        const indexUrl = new URL('/index.html', self.registration.scope).toString();
        const offline = await caches.match(indexUrl);
        if (offline) return offline;
        throw e;
      }
    })());
    return;
  }

  // Everything else: cache-first with network fallback
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch (e) {
      return Response.error();
    }
  })());
});
