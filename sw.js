const APP_VERSION = '1.1.3';
const CACHE_NAME = `saldohoras-static-${APP_VERSION}`;

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './app.html',
  './manifest.json',
  './assets/landing.css?v=29',
  './assets/app.css?v=30',
  './assets/tailwind.css?v=29',
  './assets/og-cover.png',
  './assets/icons/icon.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './js/config.js',
  './js/time.js',
  './js/cycles.js',
  './js/guest.js',
  './js/pwa.js',
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
const FONT_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);

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
  // Atualiza somente quando o usuário confirmar via Toast "Atualizar" (ou no próximo ciclo de abas fechadas)
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME && (k.startsWith('saldohoras-static-') || k.startsWith('saldohoras-shell-')))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  const url = new URL(request.url);

  // Nunca cachear chamadas autenticadas ou APIs dinâmicas
  if (
    url.hostname.includes('supabase.co')
    || url.hostname.includes('brasilapi.com.br')
    || url.pathname.includes('/rest/v1/')
    || url.pathname.includes('/auth/v1/')
    || request.headers.has('authorization')
  ) {
    return;
  }

  // Bibliotecas externas com versão e integridade SRI fixas: Cache-First versionado
  if (PINNED_CDN_SET.has(request.url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(new Request(request.url, { mode: 'cors' }));
        if (resOk(response)) {
          cache.put(request.url, response.clone());
        }
        return response;
      })
    );
    return;
  }

  // Fontes Google: Stale-While-Revalidate opcional para offline
  if (FONT_ORIGINS.has(url.origin)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(new Request(request.url, { mode: 'cors' }))
          .then((response) => {
            if (resOk(response)) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }
        const net = await networkPromise;
        return net || Response.error();
      })
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Navegação (landing ./ e app ./app.html): Network-First com fallback para o documento correspondente em cache
    if (request.mode === 'navigate' || request.destination === 'document') {
      const cleanNavUrl = new URL(url.pathname, self.location.origin).toString();
      const isAppRoute = /\/app\.html$/i.test(url.pathname);
      event.respondWith(
        fetchWithTimeout(new Request(request.url, { cache: 'no-cache' }), 2400)
          .then((response) => {
            if (resOk(response)) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(cleanNavUrl, copy));
            }
            return response;
          })
          .catch(async () => {
            const cache = await caches.open(CACHE_NAME);
            return (await cache.match(cleanNavUrl))
              || (await cache.match(request, { ignoreSearch: true }))
              || (isAppRoute ? await cache.match('./app.html') : ((await cache.match('./index.html')) || (await cache.match('./'))))
              || Response.error();
          })
      );
      return;
    }

    // Assets estáticos (JS, CSS, ícones, manifest): Stale-While-Revalidate
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(new Request(request.url, { cache: 'no-cache' }))
          .then((response) => {
            if (resOk(response)) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }

        const networkRes = await networkPromise;
        if (networkRes) return networkRes;
        return (await cache.match(request, { ignoreSearch: true })) || Response.error();
      })
    );
  }
});

function resOk(response) {
  return Boolean(response && response.ok);
}
