import admin from "firebase-admin";

export function initAdmin() {
  if (admin.apps.length) return;
  
  const serviceAccountVar = process.env.FIREBASE_SERVICE_ACCOUNT;
  
  try {
      if (serviceAccountVar) {
          const serviceAccount = JSON.parse(serviceAccountVar);
          admin.initializeApp({
              credential: admin.credential.cert(serviceAccount)
          });
      } else {
          admin.initializeApp();
      }
  } catch (e) {
      console.error("Firebase Admin Init Error:", e);
  }
}

export const db = admin.firestore;
