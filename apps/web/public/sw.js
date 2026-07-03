// Service worker do PWA OpenRate.
// - Cacheia o app shell (offline básico).
// - Network-first para chamadas de API (nunca cachear dados de tenant).
// Observação: a Background Sync API (SyncManager) é Chromium-only. No iOS a
// fila de uploads pendentes (IndexedDB) é drenada quando o PWA volta ao foco
// (ver app/(app)/app/upload); não há sincronização real em background no Safari.

const CACHE = 'openrate-shell-v1';
const SHELL = ['/', '/app', '/login', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Não interceptar API nem uploads presigned (MinIO) — sempre rede.
  if (url.pathname.startsWith('/v1') || url.hostname.includes('bucketss3')) return;

  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => undefined);
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r ?? caches.match('/'))),
  );
});
