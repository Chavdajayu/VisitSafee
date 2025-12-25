import { initAdmin } from "./firebaseAdmin.js";
import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { username } = req.query;

  if (!username) {
      return res.status(400).json({ message: "Username required" });
  }

  try {
    initAdmin();
    const db = admin.firestore();
    
    // Fetch the owner's document to get their assigned residencies
    const ownerDoc = await db.collection("owners").doc(username).get();
    
    if (!ownerDoc.exists) {
        return res.status(404).json({ message: "Owner not found" });
    }

    const ownerData = ownerDoc.data();
    const assignedResidencyNames = ownerData.residencies || [];

    if (assignedResidencyNames.length === 0) {
        return res.status(200).json({ residencies: [] });
    }

    // Fetch details for the assigned residencies
    // Since we store names, we need to find docs where name is in the list
    // Note: Firestore 'in' query supports up to 10 items. For robustness, we'll fetch all and filter 
    // or if the list is small, use 'in'. Given "All registered residencies", list might be long.
    // Efficient approach: Fetch all residencies (assuming < 100s) or batch get if we had IDs.
    // Since we have names, and name is likely unique/indexed:
    
    const allResidenciesSnapshot = await db.collection("residencies").get();
    const residencies = allResidenciesSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(residency => assignedResidencyNames.includes(residency.name));

    res.status(200).json({ residencies });

  } catch (error) {
    console.error("Owner Residencies Error:", error);
    res.status(500).json({ message: "Error fetching residencies" });
  }
}
