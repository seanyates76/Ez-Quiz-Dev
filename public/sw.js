/*
 * Service worker for EZ Quiz Web
 *
 * This service worker caches the core assets of the site, enabling offline
 * functionality. During the install phase, it caches the app shell; during
 * activation it cleans up any old caches. The fetch handler implements a
 * cache‑first strategy with a network fallback, returning the cached index
 * page for navigation requests when offline.
 */

const CACHE_NAME = 'ezquiz-cache-v129';
const RELATIVE_URLS = [
  'index.html',
  'js/state.js',
  'js/utils.js',
  'js/parser.js',
  'js/veil.js',
  'js/api.js?v=1.5.21',
  'js/settings.js',
  'js/modals.js',
  'js/boot-beta.js?v=1.5.21',
  'js/generator.js?v=1.5.21',
  'js/generator-payload.js?v=1.5.21',
  'js/a11y-announcer.js?v=1.5.21',
  'js/a11y-announcer.js',
  'js/quiz.js',
  'js/beta.mjs',
  // Versioned assets to avoid stale caches on first offline load
  'styles.css?v=1.5.21',
  'js/main.js?v=1.5.21',
  'js/auto-refresh.js?v=1.5.21',
  'js/patches.js?v=1.5.21',
  'js/editor.gui.js?v=1.5.21',
  'manifest.webmanifest',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/brand-title-source.png',
  'icons/brand-title-source-light.png',
  'icons/favicon.ico',
  'icons/favicon-16.png',
  'icons/favicon-32.png'
];
const URLS_TO_CACHE = RELATIVE_URLS.map((p) => new URL(p, self.registration.scope).toString());

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
  try {
    const proto = new URL(req.url).protocol;
    if (proto !== 'http:' && proto !== 'https:') return;
  } catch { return; }
  if (req.url.includes('/.netlify/functions/')) return; // let network handle serverless calls
  if (req.method !== 'GET') return;

  // Network-first for navigations (guarantee fresh HTML when online)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        // refresh cached index for offline
        try {
          const cache = await caches.open(CACHE_NAME);
          const indexUrl = new URL('index.html', self.registration.scope).toString();
          cache.put(indexUrl, fresh.clone());
        } catch {}
        return fresh;
      } catch (e) {
        const indexUrl = new URL('index.html', self.registration.scope).toString();
        const offline = await caches.match(indexUrl);
        if (offline) return offline;
        throw e;
      }
    })());
    return;
  }

  // For CSS/JS: try network (no-store) first, fallback to cache
  const url = new URL(req.url);
  const isCode = url.pathname.endsWith('.css') || url.pathname.endsWith('.js');
  if (isCode) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: 'no-store' });
        try { const cache = await caches.open(CACHE_NAME); cache.put(req, fresh.clone()); } catch {}
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Try queryless fallback for versioned files
        if (url.search) {
          const bareUrl = new URL(url.pathname, self.registration.scope).toString();
          const alt = await caches.match(bareUrl);
          if (alt) return alt;
        }
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
