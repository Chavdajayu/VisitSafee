import admin from "firebase-admin";
import formidable from "formidable";
import fs from "fs";
import pdf from "pdf-parse";
import bcrypt from "bcryptjs";

export const config = {
  api: {
    bodyParser: false,
  },
};

// --- Helper for Firebase Init ---
function initAdmin() {
  if (admin.apps.length) return;
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!svc) return;
  try {
    const serviceAccount = JSON.parse(svc);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (e) {
    console.error("Firebase Admin Init Error:", e);
  }
}

export default async function handler(req, res) {
  // 🔥 GUARANTEED JSON RESPONSE HEADER
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      res.status(405).json({ success: false, message: "Method not allowed" });
      return;
    }

    // 🔥 FIREBASE INIT WRAPPED
    try {
        initAdmin();
        if (!admin.apps.length) {
            throw new Error("Server configuration missing (Firebase)");
        }
    } catch (e) {
        res.status(500).json({ success: false, message: "Firebase Init Failed", error: e.message });
        return;
    }

    const db = admin.firestore();

    // 🔥 FORMIDABLE PROMISE WRAPPER
    let data;
    try {
        data = await new Promise((resolve, reject) => {
            const form = formidable({ multiples: false });
            form.parse(req, (err, fields, files) => {
                if (err) reject(err);
                else resolve({ fields, files });
            });
        });
    } catch (formError) {
        res.status(400).json({ success: false, message: "Form parsing failed", error: formError.message });
        return;
    }

    const file = data.files.file ? (Array.isArray(data.files.file) ? data.files.file[0] : data.files.file) : null;
    if (!file) {
      res.status(400).json({ success: false, message: "PDF file missing" });
      return;
    }

    // Handle residencyId
    let residencyId = data.fields.residencyId;
    if (Array.isArray(residencyId)) residencyId = residencyId[0];
    if (!residencyId) {
        res.status(400).json({ success: false, message: "Missing residencyId" });
        return;
    }

    // 🔥 PDF PARSING WRAPPED
    let pdfText = "";
    try {
      const buffer = fs.readFileSync(file.filepath);
      const parsed = await pdf(buffer);
      pdfText = parsed.text || "";
    } catch (pdfError) {
      res.status(400).json({ 
        success: false, 
        message: "PDF parsing failed", 
        error: pdfError.message, 
      }); 
      return;
    }

    const lines = pdfText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

    let created = 0;
    let skipped = 0;
    const errors = [];
    const maxBatchSize = 450;
    let batch = db.batch();
    let batchCount = 0;

    // Fetch reference data for validation
    // 🔥 ASYNC DATA FETCH WRAPPED
    let blocks, flats, occupiedFlatIds, existingUsernames, residencyRef;
    try {
        residencyRef = db.collection("residencies").doc(residencyId);
        const [blocksSnap, flatsSnap, residentsSnap] = await Promise.all([
            residencyRef.collection("blocks").get(),
            residencyRef.collection("flats").get(),
            residencyRef.collection("residents").get()
        ]);

        blocks = blocksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        flats = flatsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        occupiedFlatIds = new Set(residentsSnap.docs.map(d => d.data().flatId));
        existingUsernames = new Set(residentsSnap.docs.map(d => d.data().username));
    } catch (dbError) {
        res.status(500).json({ success: false, message: "Database fetch failed", error: dbError.message });
        return;
    }

    // 🔥 ROW PROCESSING LOOP
    for (const line of lines) {
      try {
        // Robust Parsing Logic (Preserved from previous success)
        let parts = line.split(/\s+/);
        
        if (parts.length > 0 && parts[0].toLowerCase() === 'block') {
            parts.shift();
        }

        if (parts.length < 3) {
            continue; 
        }

        const blockName = parts[0];
        const flatNumber = parts[1];
        const nameStart = parts[2];
        
        // Simple heuristic for prompt compatibility + robustness
        // Format: Block Flat Name... Phone?
        
        let residentName = nameStart; 
        let phoneRaw = null;

        // Try to identify phone at end
        if (parts.length > 3) {
             const lastPart = parts[parts.length - 1];
             if (/^(\+?[\d\-\s]+)$/.test(lastPart) && lastPart.replace(/\D/g, '').length > 5) {
                 phoneRaw = lastPart;
                 residentName = parts.slice(2, parts.length - 1).join(" ");
             } else {
                 residentName = parts.slice(2).join(" ");
             }
        } else {
            // Just 3 parts: Block Flat Name
            residentName = parts[2];
        }

        // Validation
        const block = blocks.find(b => b.name.toLowerCase() === blockName.toLowerCase());
        if (!block) {
            skipped++;
            continue;
        }

        const flat = flats.find(f => f.blockId === block.id && f.number === flatNumber.toString());
        if (!flat) {
            skipped++;
            errors.push(`Flat ${blockName}-${flatNumber} not found`);
            continue;
        }

        if (occupiedFlatIds.has(flat.id)) {
            skipped++;
            errors.push(`Flat ${blockName}-${flatNumber} occupied`);
            continue;
        }

        // Username & Password
        const username = residentName.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (existingUsernames.has(username)) {
             skipped++;
             errors.push(`Username ${username} taken`);
             continue;
        }

        let phone = null;
        if (phoneRaw) {
             phone = phoneRaw.replace(/\D/g, "");
        }

        const passwordRaw = residentName.slice(0, 4).toLowerCase() + (phone ? phone.slice(-2) : "00");
        const hashedPassword = await bcrypt.hash(passwordRaw, 10);

        // Firestore Write (Preserving correct schema: residencies/{id}/residents)
        const ref = residencyRef.collection("residents").doc(username);
        batch.set(ref, {
          username,
          password: hashedPassword,
          phone: phone ? `+91${phone}` : null,
          flatId: flat.id,
          active: true,
          createdAt: new Date().toISOString(),
          uploadedFromPdf: true
        });

        existingUsernames.add(username);
        occupiedFlatIds.add(flat.id);
        
        created++;
        batchCount++;

        if (batchCount >= maxBatchSize) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }

      } catch (rowErr) {
        skipped++;
        errors.push(rowErr.message);
      }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    // 🔥 FINAL SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      created,
      skipped,
      errors,
    });
    return;

  } catch (fatal) {
    // 🔥 LAST-RESORT SAFETY NET
    console.error("Fatal API Error:", fatal);
    res.status(500).json({
      success: false,
      message: "Server crashed but JSON response preserved",
      error: fatal?.message || "Unknown error",
    });
    return;
  }
}
