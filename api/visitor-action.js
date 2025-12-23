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
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  initAdmin();
  if (!admin.apps.length) {
    return res.status(500).json({ error: "Server configuration missing" });
  }

  const { action } = req.query;
  const { residencyId, requestId, username } = req.body || {};

  if (!action || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }
  
  const status = action === "approve" ? "approved" : "rejected";

  if (!residencyId || !requestId) {
    return res.status(400).json({ error: "Missing residencyId or requestId" });
  }

  try {
    const db = admin.firestore();
    const docRef = db.collection("residencies").doc(residencyId).collection("visitor_requests").doc(requestId);
    
    await docRef.update({
      status,
      updatedAt: new Date().toISOString(),
      actionBy: username || "notification_action",
    });

    res.status(200).json({ success: true, status });
  } catch (error) {
    console.error("Visitor Action Error:", error);
    res.status(500).json({ error: error.message });
  }
}
