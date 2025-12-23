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

    // 1. Idempotency Check & Update
    let requestRef;
    if (data?.requestId) {
      requestRef = db.collection("residencies").doc(residencyId).collection("visitor_requests").doc(data.requestId);
      const requestDoc = await requestRef.get();
      if (requestDoc.exists) {
          const reqData = requestDoc.data();
          if (reqData.notificationSent) {
            console.log(`Notification already sent for request ${data.requestId}`);
            res.status(200).json({ success: true, message: "Notification already sent" });
            return;
          }
          if (reqData.status !== "pending") {
            console.log(`Request ${data.requestId} is no longer pending`);
            res.status(200).json({ success: true, message: "Request not pending" });
            return;
          }
      }
    }

    let tokens = [];
    let flatNumber;
    let blockName;

    // Fetch tokens logic (same as before)
    if (userId) {
      const userDoc = await db.collection("residencies").doc(residencyId).collection("residents").doc(userId).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        if (u.fcmToken) tokens.push(u.fcmToken);
        // ... (fetch flat/block details if needed)
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
      // ... (fetch flat/block details)
    }

    tokens = [...new Set(tokens)];

    if (tokens.length === 0) {
      res.status(200).json({ message: "No registered devices found" });
      return;
    }

    // Construct Action URLs
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;
    
    // We pass these in the 'data' payload for the Service Worker
    const actionData = {
        ...data,
        actionUrlApprove: `${baseUrl}/api/visitor-action?action=approve&residencyId=${residencyId}&requestId=${data.requestId}`,
        actionUrlReject: `${baseUrl}/api/visitor-action?action=reject&residencyId=${residencyId}&requestId=${data.requestId}`
    };

    const message = {
      notification: {
        title: title || "New Visitor Request",
        body: body || "You have a new visitor.",
      },
      data: {
        ...actionData,
        // Convert all values to strings for FCM
        requestId: String(data.requestId || ""),
        residencyId: String(residencyId || ""),
        visitorName: String(data.visitorName || ""),
        flatId: String(data.flatId || ""),
        actionUrlApprove: actionData.actionUrlApprove,
        actionUrlReject: actionData.actionUrlReject
      },
      tokens: tokens,
    };

    const response = await admin.messaging().sendMulticast(message);

    // 2. Mark as Sent
    if (requestRef && response.successCount > 0) {
        await requestRef.update({ notificationSent: true });
    }

    res.status(200).json({ success: true, response });

  } catch (error) {
    console.error("Push Error:", error);
    res.status(500).json({ error: error.message });
  }
}
