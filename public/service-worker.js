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
    renotify: false,
    data: {
        requestId,
        actionUrlApprove,
        actionUrlReject
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
   
   if (event.action === "APPROVE") {
     if (event.notification.data.actionUrlApprove) {
         fetch(event.notification.data.actionUrlApprove, { method: "POST" })
            .then(response => {
                if (response.ok) {
                    console.log("Approved via notification");
                    // Optionally open window or show toast
                }
            });
     }
   } else if (event.action === "REJECT") {
     if (event.notification.data.actionUrlReject) {
         fetch(event.notification.data.actionUrlReject, { method: "POST" })
             .then(response => {
                if (response.ok) {
                    console.log("Rejected via notification");
                }
            });
     }
   } else {
     // Default click (open app)
     event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            if (windowClients.length > 0) {
                windowClients[0].focus();
            } else {
                clients.openWindow('/');
            }
        })
     );
   }
});
