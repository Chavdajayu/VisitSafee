import { initAdmin } from "./firebaseAdmin.js";
import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Security: This endpoint should be protected or removed in production.
  // For now, we allow it to bootstrap the first owner.
  // Ideally, check for a secret key header.
  
  const { username, password, name, residencies } = req.body;
  
  if (!username || !password) {
      return res.status(400).json({ message: "Missing fields" });
  }

  try {
    initAdmin();
    const db = admin.firestore();
    
    const ownerRef = db.collection("owners").doc(username);
    
    await ownerRef.set({
        username,
        password, // Storing plain text as per prompt requirement (but bad practice)
        name: name || username,
        residencies: residencies || [],
        createdAt: new Date().toISOString()
    });

    res.status(200).json({ success: true, message: "Owner created" });
  } catch (error) {
    console.error("Create Owner Error:", error);
    res.status(500).json({ message: "Error creating owner" });
  }
}
