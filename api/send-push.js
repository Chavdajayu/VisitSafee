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
    const { residencyId, userId, flatId, title, body, data } = req.body || {};
    if (!residencyId) {
      res.status(400).json({ error: "Missing residencyId" });
      return;
    }

    const db = admin.firestore();
    let tokens = [];

    if (userId) {
      const userDoc = await db.collection("residencies").doc(residencyId).collection("residents").doc(userId).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        if (u.fcmToken) tokens.push(u.fcmToken);
      }
    } else if (flatId) {
      const residentsRef = db.collection("residencies").doc(residencyId).collection("residents");
      const snapshot = await residentsRef.where("flatId", "==", String(flatId)).get();
      snapshot.forEach((doc) => {
        const userData = doc.data();
        if (userData.fcmToken) {
          tokens.push(userData.fcmToken);
        }
      });
    } else {
      res.status(400).json({ error: "Provide userId or flatId" });
      return;
    }

    if (tokens.length === 0) {
      res.status(200).json({ message: "No registered devices found" });
      return;
    }

    const base = {
      notification: {
        title: title || "New Visitor",
        body: body || "You have a new visitor request.",
      },
      data: data || {},
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

    let response;
    if (tokens.length === 1) {
      response = await admin.messaging().send({
        ...base,
        token: tokens[0],
      });
      res.status(200).json({ success: true, id: response });
    } else {
      response = await admin.messaging().sendEachForMulticast({
        ...base,
        tokens,
      });
      res.status(200).json({
        success: true,
        sent: response.successCount,
        failed: response.failureCount,
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
