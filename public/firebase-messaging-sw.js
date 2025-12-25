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
const messaging = firebase.messaging();

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

const __shown = new Set();

// Background message handler
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  
  const { title, body, icon } = payload.notification || {};
  const { visitorName, flat, requestId, actionUrlApprove, actionUrlReject } = payload.data || {};

  if (requestId && __shown.has(requestId)) {
    return;
  }
  if (requestId) {
    __shown.add(requestId);
  }

  const notificationTitle = title || "New Visitor Request";
  const notificationOptions = {
    body: body || `${visitorName} wants to visit`,
    icon: icon || "/icons/visitor.png",
    badge: "/icons/badge.png",
    requireInteraction: true,
    vibrate: [200, 100, 200],
    tag: requestId ? `req-${requestId}` : undefined,
    renotify: true,
    data: {
        requestId,
        actionUrlApprove,
        actionUrlReject,
        url: '/'
    },
    actions: [
        { action: "APPROVE", title: "Approve" },
        { action: "REJECT", title: "Reject" }
    ]
  };

  return self.registration.showNotification(notificationTitle, notificationOptions);
});

// Notification Click Handler (Actions)
self.addEventListener("notificationclick", event => {
   event.notification.close();
   
   const { actionUrlApprove, actionUrlReject, url } = event.notification.data || {};

   const handleAction = async () => {
       try {
           if (event.action === "APPROVE" && actionUrlApprove) {
                const response = await fetch(actionUrlApprove, { method: "POST" });
                if (response.ok) {
                    console.log("Approved via notification");
                    await self.registration.showNotification("Visitor Approved", {
                        body: "Access granted successfully.",
                        icon: "/icons/check.png",
                        timeout: 3000
                    });
                } else {
                    throw new Error("Approval failed");
                }
           } else if (event.action === "REJECT" && actionUrlReject) {
                const response = await fetch(actionUrlReject, { method: "POST" });
                if (response.ok) {
                    console.log("Rejected via notification");
                    await self.registration.showNotification("Visitor Rejected", {
                        body: "Access denied.",
                        icon: "/icons/cross.png",
                        timeout: 3000
                    });
                } else {
                    throw new Error("Rejection failed");
                }
           } else {
             // Default click (open app)
             const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
             for (let client of windowClients) {
                 if (client.url.includes(self.registration.scope) && 'focus' in client) {
                     return client.focus();
                 }
             }
             if (clients.openWindow) {
                 return clients.openWindow(url || '/');
             }
           }
       } catch (error) {
           console.error("Notification click error:", error);
           if (clients.openWindow) {
                return clients.openWindow('/');
           }
       }
   };

   event.waitUntil(handleAction());
});
