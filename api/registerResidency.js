import { initAdmin } from "./firebaseAdmin.js";
import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { 
    residencyName, 
    adminUsername, 
    adminPassword, 
    adminPhone,
    ownerId = "jaydeep" // Default to 'jaydeep' if not provided
  } = req.body;

  if (!residencyName || !adminUsername || !adminPassword) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    initAdmin();
    const db = admin.firestore();

    // 1. Create Residency Document
    // Using residencyName as ID for consistency
    const residencyRef = db.collection("residencies").doc(residencyName);
    
    // Check if already exists to prevent overwrite/duplication errors
    const docSnap = await residencyRef.get();
    if (docSnap.exists) {
        return res.status(409).json({ message: "Residency already exists" });
    }

    const residencyData = {
      name: residencyName,
      adminUsername,
      adminPassword, // Storing as plain text per existing pattern
      adminPhone: adminPhone || null,
      createdAt: new Date().toISOString(),
      serviceStatus: "ON",
      ownerId: ownerId
    };

    await residencyRef.set(residencyData);

    // 2. Automatically Update Owner's Document
    // This mimics the Cloud Function trigger: "addResidencyToOwner"
    const ownerRef = db.collection("owners").doc(ownerId);
    
    // Use arrayUnion to add the new residency name to the list
    try {
        await ownerRef.update({
          residencies: admin.firestore.FieldValue.arrayUnion(residencyName)
        });
    } catch (ownerError) {
        // If owner doc doesn't exist, create it
        if (ownerError.code === 5 || ownerError.message.includes('NOT_FOUND')) {
             await ownerRef.set({
                residencies: [residencyName],
                username: ownerId,
                createdAt: new Date().toISOString()
             });
        } else {
            throw ownerError;
        }
    }

    return res.status(200).json({ 
        success: true, 
        message: "Residency registered and assigned to owner.",
        data: {
            id: residencyName,
            name: residencyName,
            adminUsername,
            createdAt: residencyData.createdAt
        }
    });

  } catch (error) {
    console.error("Register Residency Error:", error);
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
}
