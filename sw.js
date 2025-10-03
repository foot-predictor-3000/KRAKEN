/* // Patched SW cache version */
const CACHE_NAME = 'turfbeard-v20250919b';
const ASSET_PATTERNS = [ '.js', '.css', '.woff', '.woff2', '.ttf', '.otf', '.png', '.jpg', '.svg' ];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

// Network-first for HTML (to avoid serving stale index.html that might include classic scripts)
async function handleHtml(request) {
  try {
    const fresh = await fetch(request, { cache: 'no-store' });
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

// Cache-first for static assets
async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;

  // Treat HTML-like requests as HTML
  const isHtml = req.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isHtml) {
    event.respondWith(handleHtml(req));
    return;
  }

  // Only cache asset-like requests; let others pass through
  const isAsset = ASSET_PATTERNS.some(ext => url.pathname.endsWith(ext));
  if (isAsset) {
    event.respondWith(handleAsset(req));
  }
});
