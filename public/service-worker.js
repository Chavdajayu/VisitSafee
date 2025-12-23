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

// Firebase Messaging Background Handler
messaging.onBackgroundMessage(function(payload) {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  // Customize notification here
  const notificationTitle = payload.notification?.title || payload.data?.title || 'VisitSafe';
  const notificationOptions = {
    ...payload.notification,
    body: payload.notification?.body || payload.data?.body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: payload.data || {},
    actions: []
  };

  // If data contains necessary IDs, add actions
  if (notificationOptions.data.requestId && notificationOptions.data.residencyId && notificationOptions.data.username) {
      notificationOptions.actions = [
          { action: 'approve', title: 'Approve' },
          { action: 'reject', title: 'Reject' }
      ];
  }

  // URL handling
  if (!notificationOptions.data.url) {
      notificationOptions.data.url = payload.fcmOptions?.link || payload.data?.click_action || '/';
  }

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Generic Push event fallback (ensures display when app is closed)
self.addEventListener('push', function(event) {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.notification?.title || data.title || 'VisitSafe';
    const options = {
      body: data.notification?.body || data.body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: data.data || {},
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
    // Perform Firestore update directly from Service Worker
    const promise = db.collection('residencies')
        .doc(data.residencyId)
        .collection('visitor_requests')
        .doc(data.requestId)
        .update({
            status: action === 'approve' ? 'approved' : 'rejected',
            updatedAt: new Date().toISOString(),
            actionBy: data.username
        }).then(() => {
             // Show success notification
             return self.registration.showNotification('VisitSafe', {
                body: `Visitor request ${action === 'approve' ? 'approved' : 'rejected'}.`,
                icon: '/favicon.png'
             });
        }).catch(err => {
            console.error('Error updating status:', err);
             // If update fails, fallback to opening the app
             if (clients.openWindow) {
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
