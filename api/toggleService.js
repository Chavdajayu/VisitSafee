import { initAdmin } from "./firebaseAdmin.js";
import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { residencyId, status } = req.body;

  if (!residencyId || !status) {
      return res.status(400).json({ message: "Missing parameters" });
  }

  if (status !== 'ON' && status !== 'OFF') {
      return res.status(400).json({ message: "Invalid status" });
  }

  try {
    initAdmin();
    const db = admin.firestore();
    
    const residencyRef = db.collection("residencies").doc(residencyId);
    await residencyRef.update({ serviceStatus: status });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Toggle Service Error:", error);
    res.status(500).json({ message: "Failed to toggle service" });
  }
}
