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
    
    const ownerRef = db.collection("owners").doc(username);
    const ownerSnapshot = await ownerRef.get();

    if (!ownerSnapshot.exists) {
      return res.status(404).json({ message: "Owner not found" });
    }

    const owner = ownerSnapshot.data();
    const residencyIds = owner.residencies || [];
    
    if (residencyIds.length === 0) {
        return res.status(200).json({ residencies: [] });
    }

    // Fetch all residencies details
    // Firestore "in" query allows up to 10 items. If more, we need to batch or loop.
    // Assuming < 10 for now or fetch individually.
    
    const residenciesRef = db.collection("residencies");
    // const snapshot = await residenciesRef.where(admin.firestore.FieldPath.documentId(), 'in', residencyIds).get();
    // 'in' query on documentId works.
    
    // However, if residencyIds is large, 'in' fails.
    // Safer to fetch individually for robustness if list is small, or use multiple queries.
    // Let's use Promise.all with individual gets.
    
    const residencyPromises = residencyIds.map(id => residenciesRef.doc(id).get());
    const residencySnapshots = await Promise.all(residencyPromises);
    
    const residencies = residencySnapshots
        .filter(snap => snap.exists)
        .map(snap => ({
            id: snap.id,
            ...snap.data()
        }));

    res.status(200).json({ residencies });

  } catch (error) {
    console.error("Owner Residencies Error:", error);
    res.status(500).json({ message: "Error fetching residencies" });
  }
}
