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
    
    // Query residencies where ownerId matches the username
    // This allows for automatic updates when new residencies are added with this ownerId
    const residenciesSnapshot = await db.collection("residencies")
        .where("ownerId", "==", username)
        .get();

    const residencies = residenciesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));

    res.status(200).json({ residencies });

  } catch (error) {
    console.error("Owner Residencies Error:", error);
    res.status(500).json({ message: "Error fetching residencies" });
  }
}
