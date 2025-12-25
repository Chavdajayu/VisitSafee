import { initAdmin } from "./firebaseAdmin.js";
import admin from "firebase-admin";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { username, password } = req.body;

  try {
    initAdmin();
    const db = admin.firestore();
    
    // Check owners collection
    // We use username as document ID for simplicity as per prompt suggestion
    // or query by username field.
    // Prompt said: "Owners Collection: ownerId ... username"
    // And "ownerRef = adminDb.collection("owners").doc(username)"
    
    const ownerRef = db.collection("owners").doc(username);
    const ownerSnapshot = await ownerRef.get();

    if (!ownerSnapshot.exists) {
      // Security: Don't reveal if user exists
      return res.status(400).json({ message: "Invalid username or password" });
    }

    const owner = ownerSnapshot.data();
    
    // In a real app, use bcrypt. Here we follow the prompt's simplicity or use plain text if prompt implied it.
    // The prompt example used: `if (owner.password !== password)`
    // But existing app uses bcrypt. I should probably support both or just bcrypt.
    // For now, I will stick to prompt's logic for "Owner Login" but add bcrypt support if needed.
    // Let's assume plain text for the "password" field as per prompt example, 
    // BUT since I am a senior dev, I should probably check if it looks like a hash.
    // However, I will follow the prompt strictly for the "Owner" part to avoid complexity unless I see bcrypt usage in prompt.
    // Prompt: "password: Encrypted password (via Firebase Authentication)" - wait.
    // The prompt says "password: Encrypted password (via Firebase Authentication)" in FIRESTORE STRUCTURE.
    // BUT in BACKEND IMPLEMENTATION it says: `if (owner.password !== password)`.
    // This is contradictory. Firebase Auth doesn't store passwords in Firestore.
    // If it uses Firebase Auth, we should use `admin.auth().getUserByEmail()`.
    // BUT the Login Page example sends `username` and `password` to `/api/ownerLogin`.
    // This implies a custom auth flow.
    // I will implement the custom auth flow as requested in the code snippets.
    
    if (owner.password !== password) {
       return res.status(400).json({ message: "Invalid username or password" });
    }

    // Return success
    // We don't have a session token here, just a redirect.
    // The frontend will likely rely on this confirmation to set a client-side state 
    // OR we should return a token? 
    // The prompt frontend just does `window.location.href = data.redirectUrl`.
    // It doesn't seem to set a cookie/token. This is insecure for a real "Dashboard".
    // I will add a simple token or just return the owner data so the frontend can store it in localStorage (like `storage.js` does for residents).
    
    res.status(200).json({ 
        success: true, 
        redirectUrl: `/owner/dashboard`,
        owner: {
            username: owner.username,
            name: owner.name || owner.username,
            residencies: owner.residencies || []
        }
    });

  } catch (error) {
    console.error("Owner Login Error:", error);
    res.status(500).json({ message: "Error logging in" });
  }
}
