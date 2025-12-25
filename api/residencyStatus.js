import { initAdmin } from "./firebaseAdmin.js";
import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { societyName } = req.query;

  if (!societyName) {
      return res.status(400).json({ message: "Society name required" });
  }

  try {
    initAdmin();
    const db = admin.firestore();
    
    // Check if society exists in "residencies" collection
    // Note: societyName is treated as the ID in the previous implementation logic (from ownerResidencies)
    // but in existing app logic, it might be just a field.
    // The user's prompt says:
    // residencies collection: residencyId, name, serviceStatus.
    // In App.jsx, we see params.societyName.
    // We should assume societyName maps to the residencyId for simplicity or check if it matches 'name' field.
    // Given "Rajhansh Residency" example, let's try to find by ID first, if not, find by name.
    
    let residencyRef = db.collection("residencies").doc(societyName);
    let residencySnapshot = await residencyRef.get();

    if (!residencySnapshot.exists) {
        // Try searching by name if ID lookup fails
        const snapshot = await db.collection("residencies").where("name", "==", societyName).limit(1).get();
        if (!snapshot.empty) {
            residencySnapshot = snapshot.docs[0];
        } else {
             // If not found in residencies collection, it might be a legacy residency not yet in the system.
             // Default to ON so we don't break existing sites.
             return res.status(200).json({ serviceStatus: "ON" });
        }
    }

    const residency = residencySnapshot.data();
    // Default to ON if field is missing
    const status = residency.serviceStatus || "ON";

    res.status(200).json({ serviceStatus: status });

  } catch (error) {
    console.error("Residency Status Error:", error);
    // Fail safe to ON to avoid blocking users on error
    res.status(200).json({ serviceStatus: "ON" });
  }
}
