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
    const { residencyId, requestId, status, username } = req.body || {};
    if (!residencyId || !requestId || !status) {
      res.status(400).json({ error: "Missing residencyId, requestId, or status" });
      return;
    }
    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const db = admin.firestore();
    const docRef = db.collection("residencies").doc(residencyId).collection("visitor_requests").doc(requestId);
    await docRef.update({
      status,
      updatedAt: new Date().toISOString(),
      actionBy: username || "notification_action",
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
