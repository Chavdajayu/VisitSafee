import admin from "firebase-admin";

function initAdmin() {
  if (admin.apps.length) return;
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svc) return;
  try {
    const serviceAccount = JSON.parse(svc);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch {
    // ignore
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  initAdmin();
  if (!admin.apps.length) {
    res.status(500).json({ error: "Server configuration missing (Firebase Admin)" });
    return;
  }

  try {
    const { residencyId, flatId, title, body, data } = req.body || {};
    if (!residencyId || !flatId) {
      res.status(400).json({ error: "Missing residencyId or flatId" });
      return;
    }

    const db = admin.firestore();
    const residentsRef = db.collection("residencies").doc(residencyId).collection("residents");
    const snapshot = await residentsRef.where("flatId", "==", flatId).get();

    const tokens = [];
    snapshot.forEach((doc) => {
      const userData = doc.data();
      if (userData.fcmToken) {
        tokens.push(userData.fcmToken);
      }
    });

    if (tokens.length === 0) {
      res.status(200).json({ message: "No registered devices found for this flat" });
      return;
    }

    const message = {
      notification: {
        title: title || "New Visitor",
        body: body || "You have a new visitor request.",
      },
      data: data || {},
      tokens,
      android: {
        priority: "high",
        notification: {
          priority: "max",
          channelId: "visitsafe_visitors",
          defaultSound: true,
          visibility: "public",
        },
      },
      webpush: {
        headers: { Urgency: "high" },
        fcmOptions: {
          link: (data && data.url) || "/",
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    res.status(200).json({
      success: true,
      sent: response.successCount,
      failed: response.failureCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
