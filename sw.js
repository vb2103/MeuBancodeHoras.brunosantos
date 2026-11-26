const CACHE_NAME = 'saldohoras-shell-v25';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/app.css?v=25',
  './assets/tailwind.css?v=25',
  './assets/icons/icon.svg',
  './js/config.js',
  './js/time.js',
  './js/sync-queue.js',
  './js/rules-catalog.js',
  './js/holidays.js',
  './js/db.js',
  './js/security.js',
  './js/vendor-loader.js',
  './js/ui-motion.js',
  './js/auth.js',
  './js/charts.js',
  './js/export.js',
  './js/export-modal.js',
  './js/modals.js',
  './js/profile.js',
  './js/app.js'
];

const PINNED_CDN_ASSETS = [
  'https://unpkg.com/lucide@1.81.0/dist/umd/lucide.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

const PINNED_CDN_SET = new Set(PINNED_CDN_ASSETS);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([
        ...APP_SHELL_ASSETS.map((asset) =>
          fetch(new Request(asset, { cache: 'no-cache' }))
            .then((res) => (resOk(res) ? cache.put(asset, res) : null))
            .catch(() => null)
        ),
        ...PINNED_CDN_ASSETS.map((cdnUrl) =>
          fetch(new Request(cdnUrl, { mode: 'cors', cache: 'force-cache' }))
            .then((res) => (resOk(res) ? cache.put(cdnUrl, res) : null))
            .catch(() => null)
        )
      ])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function fetchWithTimeout(request, timeoutMs = 2400) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SW network timeout')), timeoutMs);
    fetch(request)
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Nunca interceptar chamadas autenticadas ou APIs dinâmicas
  if (url.hostname.includes('supabase.co') || url.hostname.includes('brasilapi.com.br')) {
    return;
  }

  // Bibliotecas externas com versão e integridade fixas usam Cache-First para abrir instantâneo e offline
  if (PINNED_CDN_SET.has(request.url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(new Request(request.url, { mode: 'cors' })).then((response) => {
          if (resOk(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request.url, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Assets locais da mesma origem: Network-First com timeout rápido para fallback imediato ao cache offline
  if (url.origin === self.location.origin) {
    const netReq = request.mode === 'navigate'
      ? new Request(request.url, { cache: 'no-cache' })
      : new Request(request, { cache: 'no-cache' });

    event.respondWith(
      fetchWithTimeout(netReq, 2400)
        .then((response) => {
          if (resOk(response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});

function resOk(response) {
  return Boolean(response && response.ok);
}
