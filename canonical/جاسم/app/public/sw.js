const CACHE_NAME = 'jasim-v33.2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/main.tsx',
  '/src/index.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  // API responses can contain owner-scoped conversations, runs, artifacts, or
  // lineage. Keep them network-only so a shared browser cache never becomes a
  // second persistence layer for private state.
  if (request.url.includes('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: 'Offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response));
          }
        });
        return cached;
      }

      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return new Response('Offline', { status: 503 });
        });
    })
  );
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(
      data.title ?? 'JASIM Notification',
      {
        body: data.body ?? 'New update available',
        icon: '/icon-192x192.png',
        badge: '/icon-72x72.png',
        tag: data.tag ?? 'default',
        requireInteraction: data.requireInteraction ?? false,
        data: data.payload ?? {},
      }
    )
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.openWindow('/')
  );
});
