const CACHE_NAME = 'saldohoras-shell-v10';

const APP_SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/app.css',
  './assets/tailwind.css',
  './assets/icons/icon.svg',
  './js/config.js',
  './js/time.js',
  './js/rules-catalog.js',
  './js/holidays.js',
  './js/db.js',
  './js/security.js',
  './js/auth.js',
  './js/charts.js',
  './js/export.js',
  './js/export-modal.js',
  './js/modals.js',
  './js/profile.js',
  './js/app.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Nunca interceptar/cachear chamadas autenticadas ao Supabase ou APIs externas dinâmicas
  if (url.hostname.includes('supabase.co') || url.hostname.includes('brasilapi.com.br')) {
    return;
  }

  // Apenas assets locais da mesma origem usam Network-First com fallback de cache offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});
