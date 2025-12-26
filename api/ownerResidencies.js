import { db } from "./firebaseClient.js";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { username } = req.query;

  if (!username) {
      return res.status(400).json({ message: "Username required" });
  }

  try {
    // Fetch the owner's document to get their assigned residencies
    const ownerRef = doc(db, "owners", username);
    const ownerDoc = await getDoc(ownerRef);
    
    if (!ownerDoc.exists()) {
        return res.status(404).json({ message: "Owner not found" });
    }

    const ownerData = ownerDoc.data();
    const assignedResidencyNames = ownerData.residencies || [];

    if (assignedResidencyNames.length === 0) {
        return res.status(200).json({ residencies: [] });
    }

    // Fetch all residencies and filter
    const residenciesRef = collection(db, "residencies");
    const allResidenciesSnapshot = await getDocs(residenciesRef);
    
    const residencies = allResidenciesSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(residency => assignedResidencyNames.includes(residency.name));

    res.status(200).json({ residencies });

  } catch (error) {
    console.error("Owner Residencies Error:", error);
    res.status(500).json({ message: "Error fetching residencies" });
  }
}
