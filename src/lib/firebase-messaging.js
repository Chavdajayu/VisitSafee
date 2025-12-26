import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { app, db } from "./firebase";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";

let messaging = null;

export const initMessaging = async () => {
  if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    try {
      messaging = getMessaging(app);

      // Foreground message handler
      onMessage(messaging, (payload) => {
        console.log("Foreground Message received: ", payload);
        const { title, body, icon } = payload.notification || {};
        
        // Show notification if permission granted
        // This satisfies Step 5: "Show notification ONLY when app is active" (handled by JS here)
        if (Notification.permission === "granted") {
           // Step 6: De-duplication using tag
           const notificationOptions = {
               body: body,
               icon: icon || '/icons/icon-192.png',
               tag: payload.messageId // Use messageId to prevent duplicates
           };
           
           // Use the service worker registration to show notification if available, 
           // otherwise fallback to new Notification()
           if (navigator.serviceWorker.controller) {
               navigator.serviceWorker.ready.then(registration => {
                   registration.showNotification(title, notificationOptions);
               });
           } else {
               new Notification(title, notificationOptions);
           }
        }
      });
    } catch (error) {
      console.error("Messaging initialization failed", error);
    }
  }
};

export const requestToken = async () => {
  if (!messaging) await initMessaging();
  if (!messaging) return;

  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      const registration = await navigator.serviceWorker.ready;
      
      const token = await getToken(messaging, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
        serviceWorkerRegistration: registration
      });

      if (token) {
        console.log("FCM Token:", token);
        await saveTokenToFirestore(token);
      }
    }
  } catch (error) {
    console.error("Error retrieving token:", error);
  }
};

const saveTokenToFirestore = async (token) => {
  try {
    const sessionStr = localStorage.getItem("society_user_session");
    if (!sessionStr) return;

    const session = JSON.parse(sessionStr);
    if (!session.loggedIn) return;

    const { residencyId, username, role } = session;
    if (!residencyId || !username) return;

    let userRef = null;
    let updateData = {};

    if (role === "admin") {
       userRef = doc(db, "residencies", residencyId);
       updateData = { adminFcmTokens: arrayUnion(token) };
    } else if (role === "resident") {
       userRef = doc(db, "residencies", residencyId, "residents", username);
       updateData = { fcmTokens: arrayUnion(token) };
    } else if (role === "guard") {
       userRef = doc(db, "residencies", residencyId, "guards", username);
       updateData = { fcmTokens: arrayUnion(token) };
    }

    if (userRef) {
      await updateDoc(userRef, updateData);
      console.log("Token saved to Firestore");
    }
  } catch (err) {
    console.error("Error saving token to Firestore:", err);
  }
};
