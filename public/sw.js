/* Cache only the app shell. Credentials and API responses never enter this cache. */
const ASSET_VERSION = '4.0.0';
const CACHE_NAME = 'ezq-standalone-v4';
const MODULES = ["theme-preload.js","boot-beta.js","main.js","landing-intro.js","auto-refresh.js","patches.js","editor.gui.js","generator.js","generator-payload.js","source-sections.js","a11y-announcer.js","api.js","explain-api.js","state.js","utils.js","parser.js","veil.js","settings.js","modals.js","quiz.js","beta.mjs","flags.js","settings.beta.js","import-controller.js","file-type-validation.js","media-import-constraints.js","drag-drop.js","standalone.js"];
const STYLES = ['styles.css', 'styles.tokens.css', 'styles.backdrop.css', 'styles.standalone.css'];
const STATIC_PATHS = [
  'index.html', 'standalone.html', 'privacy.html', 'terms.html', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/brand-title-source.png', 'icons/brand-title-source-light.png',
  ...MODULES.flatMap(name => ['js/' + name, 'js/' + name + '?v=' + ASSET_VERSION]),
  ...STYLES.flatMap(name => [name, name + '?v=' + ASSET_VERSION]),
];
const cacheUrl = p => new URL(p, self.registration.scope).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_PATHS.map(cacheUrl))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(n => n.startsWith('ezq-') && n !== CACHE_NAME).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if(event.data === 'SKIP_WAITING') self.skipWaiting();
  if(event.data === 'CLEAR_CACHES') event.waitUntil(caches.keys().then(names => Promise.all(names.filter(n => n.startsWith('ezq-')).map(n => caches.delete(n)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if(event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  if(event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(event.request, { ignoreSearch: true }) || await cache.match(cacheUrl('index.html')) || Response.error();
    }));
    return;
  }
  // Restrict caching to known static paths. Never cache session tokens or arbitrary URLs.
  if(!STATIC_PATHS.map(cacheUrl).includes(url.href)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => await cache.match(event.request) || fetch(event.request)));
});
