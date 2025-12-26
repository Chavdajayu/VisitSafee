const CACHE_NAME = 'visitsafe-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ❌ Do NOT cache Firestore requests
  if (url.hostname.includes('firestore.googleapis.com') || 
      url.hostname.includes('firebase') ||
      url.hostname.includes('googleapis.com')) {
    return;
  }
  
  // ❌ Do NOT cache API calls
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network First Strategy
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Check if valid response
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Only cache same-origin requests (static assets)
        if (url.origin === location.origin) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
        }
        
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((response) => {
            if (response) {
                return response;
            }
            // Offline fallback for navigation
            if (event.request.mode === 'navigate') {
                return caches.match('/index.html');
            }
        });
      })
  );
});
