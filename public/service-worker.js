importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyC8fWiD792P2naHvsz8tiKI6pHTRu2wbdQ",
  authDomain: "entry-8709c.firebaseapp.com",
  projectId: "entry-8709c",
  storageBucket: "entry-8709c.firebasestorage.app",
  messagingSenderId: "947187754062",
  appId: "1:947187754062:web:6e8ccff8ecf2e6472c0f1f"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const messaging = firebase.messaging();

const CACHE_NAME = 'visitsafe-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/favicon.png',
  '/manifest.json'
];

self.addEventListener('install', event => {
  // Activate immediately
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Navigation requests: Network First, then Cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // Static assets (hashed): Cache First, then Network (and update cache)
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request).then(networkResponse => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
            return networkResponse;
        });
      })
  );
});

self.addEventListener('push', function(event) {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'VisitSafe';
    const body =
      data.body ||
      [
        data.visitorName ? `👤 ${data.visitorName}` : null,
        data.flatNumber ? `🏠 Flat ${data.flatNumber}` : null,
        data.phone ? `📞 ${data.phone}` : null,
      ]
        .filter(Boolean)
        .join('\n') || 'New visitor request';
    const options = {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.requestId || undefined,
      renotify: false,
      data,
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'reject', title: 'Reject' },
      ],
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    // ignore malformed payloads
  }
});

// Notification Click Handler
self.addEventListener('notificationclick', function(event) {
  const notification = event.notification;
  const action = event.action;
  const data = notification.data;

  notification.close();

  if (action === 'approve' || action === 'reject') {
    const promise = fetch('/api/update-request-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        residencyId: data.residencyId,
        requestId: data.requestId,
        status: action === 'approve' ? 'approved' : 'rejected',
        username: data.username
      })
    }).then(async (resp) => {
      if (!resp.ok) throw new Error('Status update failed');
      return self.registration.showNotification('VisitSafe', {
        body: `Visitor request ${action === 'approve' ? 'approved' : 'rejected'}.`,
        icon: '/favicon.ico'
      });
    }).catch(err => {
      console.error('Error updating status:', err);
      if (clients.openWindow && data.url) {
        return clients.openWindow(data.url);
      }
    });

    event.waitUntil(promise);

  } else {
    // Default click (open app)
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Check if there is already a window open with this URL
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                // Check if the client is the app (same origin)
                if (client.url.includes(self.registration.scope) && 'focus' in client) {
                    // Focus the client
                    return client.focus().then(focusedClient => {
                        // Navigate to the specific URL if needed
                        if (focusedClient.url !== data.url && data.url) {
                             return focusedClient.navigate(data.url);
                        }
                        return focusedClient;
                    });
                }
            }
            // If no window is open, open a new one
            if (clients.openWindow && data.url) {
                return clients.openWindow(data.url);
            }
        })
    );
  }
});
