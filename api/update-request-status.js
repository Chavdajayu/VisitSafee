import { db } from "./firebaseClient.js";
import { doc, updateDoc } from "firebase/firestore";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const { residencyId, requestId, status, username } = req.body || {};
    if (!residencyId || !requestId || !status) {
      res.status(400).json({ error: "Missing residencyId, requestId, or status" });
      return;
    }
    if (!["approved", "rejected"].includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }

    const docRef = doc(db, "residencies", residencyId, "visitor_requests", requestId);
    await updateDoc(docRef, {
      status,
      updatedAt: new Date().toISOString(),
      actionBy: username || "notification_action",
    });
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
