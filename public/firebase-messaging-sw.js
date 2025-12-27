const CACHE_NAME = 'visitsafe-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Import Firebase Scripts (Compat versions)
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.0.0/firebase-messaging-compat.js');

// Initialize Firebase using URL params
const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  storageBucket: params.get('storageBucket'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
};

// Initialize Firebase Messaging if config is present
if (firebaseConfig.apiKey) {
    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();

    // Background Message Handler with Rich Notifications
    messaging.onBackgroundMessage((payload) => {
      console.log('[firebase-messaging-sw.js] Received background message ', payload);
      
      const { title, body, icon } = payload.notification || {};
      const data = payload.data || {};
      
      // Check if this is a visitor request notification
      const isVisitorRequest = data.type === 'visitor_request' || data.actionType === 'visitor_request';
      
      const notificationOptions = {
        body: body,
        icon: icon || '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.requestId || payload.messageId, // Prevent duplicates
        requireInteraction: isVisitorRequest, // Keep visitor requests visible
        data: data // Pass data for click handling
      };
      
      // Add action buttons for visitor requests
      if (isVisitorRequest && data.requestId) {
        notificationOptions.actions = [
          {
            action: 'approve',
            title: '✅ Approve',
            icon: '/icons/icon-192.png'
          },
          {
            action: 'reject', 
            title: '❌ Reject',
            icon: '/icons/icon-192.png'
          }
        ];
      }

      self.registration.showNotification(title, notificationOptions);
    });
}

// Handle notification clicks and actions
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click received:', event);
  
  event.notification.close();
  
  const data = event.notification.data || {};
  const action = event.action;
  
  if (action === 'approve' || action === 'reject') {
    // Handle approve/reject actions
    const requestId = data.requestId;
    if (requestId) {
      // Update request status via API
      event.waitUntil(
        fetch('/api/update-request-status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requestId: requestId,
            status: action === 'approve' ? 'approved' : 'rejected',
            residencyId: data.residencyId || 'unknown'
          })
        }).then(response => {
          if (response.ok) {
            console.log(`Request ${requestId} ${action}d successfully`);
            // Show confirmation notification
            self.registration.showNotification(
              `Request ${action === 'approve' ? 'Approved' : 'Rejected'}`,
              {
                body: `Visitor request has been ${action}d`,
                icon: '/icons/icon-192.png',
                tag: `${requestId}-${action}`,
                actions: []
              }
            );
          } else {
            console.error(`Failed to ${action} request:`, response.statusText);
          }
        }).catch(error => {
          console.error(`Error ${action}ing request:`, error);
        })
      );
    }
  } else {
    // Default click - open app
    const urlToOpen = data.url || '/';
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Check if app is already open
          for (const client of clientList) {
            if (client.url.includes(self.location.origin) && 'focus' in client) {
              client.focus();
              if (urlToOpen !== '/') {
                client.navigate(urlToOpen);
              }
              return;
            }
          }
          // Open new window if app not open
          if (clients.openWindow) {
            return clients.openWindow(urlToOpen);
          }
        })
    );
  }
});

// === PWA LOGIC ===

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
