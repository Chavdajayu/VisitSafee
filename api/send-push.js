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

    // 1. Idempotency Check
    if (data?.requestId) {
      const requestRef = db.collection("residencies").doc(residencyId).collection("visitor_requests").doc(data.requestId);
      const requestDoc = await requestRef.get();
      if (requestDoc.exists && requestDoc.data().notificationSent) {
        console.log(`Notification already sent for request ${data.requestId}`);
        res.status(200).json({ success: true, message: "Notification already sent" });
        return;
      }
    }

    let tokens = [];
    let flatNumber;
    let blockName;

    if (userId) {
      const userDoc = await db.collection("residencies").doc(residencyId).collection("residents").doc(userId).get();
      if (userDoc.exists) {
        const u = userDoc.data();
        if (u.fcmToken) tokens.push(u.fcmToken);
        if (u.flatId) {
          const flatDoc = await db.collection("residencies").doc(residencyId).collection("flats").doc(String(u.flatId)).get();
          if (flatDoc.exists) {
            const fd = flatDoc.data();
            flatNumber = fd?.number;
            if (fd?.blockId) {
              const blockDoc = await db.collection("residencies").doc(residencyId).collection("blocks").doc(String(fd.blockId)).get();
              if (blockDoc.exists) blockName = blockDoc.data()?.name;
            }
          }
        }
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
      const flatDoc = await db.collection("residencies").doc(residencyId).collection("flats").doc(String(flatId)).get();
      if (flatDoc.exists) {
        const fd = flatDoc.data();
        flatNumber = fd?.number;
        if (fd?.blockId) {
          const blockDoc = await db.collection("residencies").doc(residencyId).collection("blocks").doc(String(fd.blockId)).get();
          if (blockDoc.exists) blockName = blockDoc.data()?.name;
        }
      }
    } else {
      res.status(400).json({ error: "Provide userId or flatId" });
      return;
    }

    // 2. Deduplicate tokens
    tokens = [...new Set(tokens)];

    if (tokens.length === 0) {
      res.status(200).json({ message: "No registered devices found" });
      return;
    }

    const payloadData = {
      ...(data || {}),
      title: title || "New Visitor",
      body: body || "You have a new visitor request.",
      requestId: data?.requestId || "",
      residencyId,
      flatId: String(flatId || data?.flatId || ""),
      flatNumber: flatNumber ? String(flatNumber) : "",
      location: blockName && flatNumber ? `${blockName} • Flat ${flatNumber}` : (flatNumber ? `Flat ${flatNumber}` : ""),
    };

    // 3. Message Config for Background/Closed App Functionality
    const messageConfig = {
      notification: {
        title: payloadData.title,
        body: payloadData.body,
      },
      data: payloadData,
      android: {
        priority: 'high',
        notification: {
          priority: 'max',
          channelId: 'visitsafe_visitors',
          defaultSound: true,
          visibility: 'public',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK' // Standard for many frameworks, or handled by SW
        }
      },
      webpush: {
        headers: {
          Urgency: 'high'
        },
        fcmOptions: {
          link: payloadData.url || '/'
        }
      }
    };

    let response;
    if (tokens.length === 1) {
      response = await admin.messaging().send({
        token: tokens[0],
        ...messageConfig
      });
      // Mark as sent
      if (data?.requestId) {
        await db.collection("residencies").doc(residencyId).collection("visitor_requests").doc(data.requestId).update({
          notificationSent: true
        });
      }
      res.status(200).json({ success: true, id: response });
    } else {
      response = await admin.messaging().sendEachForMulticast({
        tokens,
        ...messageConfig
      });
      // Mark as sent if at least one success
      if (response.successCount > 0 && data?.requestId) {
        await db.collection("residencies").doc(residencyId).collection("visitor_requests").doc(data.requestId).update({
          notificationSent: true
        });
      }
      res.status(200).json({
        success: true,
        sent: response.successCount,
        failed: response.failureCount,
      });
    }
  } catch (error) {
    console.error("Push send error:", error);
    res.status(500).json({ error: error.message });
  }
}
