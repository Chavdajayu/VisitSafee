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
  // Always set JSON content type
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method not allowed" });
    }

    initAdmin();
    if (!admin.apps.length) {
      return res.status(500).json({ success: false, message: "Server configuration missing (Firebase)" });
    }

    const db = admin.firestore();

    // Promisify formidable
    const { fields, files } = await new Promise((resolve, reject) => {
        const form = formidable({ multiples: false });
        form.parse(req, (err, fields, files) => {
            if (err) reject(err);
            else resolve({ fields, files });
        });
    });

    const file = files.file ? (Array.isArray(files.file) ? files.file[0] : files.file) : null;
    if (!file) {
      return res.status(400).json({ success: false, message: "PDF missing" });
    }

    // Handle residencyId
    let residencyId = fields.residencyId;
    if (Array.isArray(residencyId)) residencyId = residencyId[0];
    if (!residencyId) {
        return res.status(400).json({ success: false, message: "Missing residencyId" });
    }

    const buffer = fs.readFileSync(file.filepath);
    const data = await pdf(buffer);

    const lines = data.text
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
    const residencyRef = db.collection("residencies").doc(residencyId);
    const [blocksSnap, flatsSnap, residentsSnap] = await Promise.all([
        residencyRef.collection("blocks").get(),
        residencyRef.collection("flats").get(),
        residencyRef.collection("residents").get()
    ]);

    const blocks = blocksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const flats = flatsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const occupiedFlatIds = new Set(residentsSnap.docs.map(d => d.data().flatId));
    const existingUsernames = new Set(residentsSnap.docs.map(d => d.data().username));

    for (const line of lines) {
      try {
        // FORMAT: Block [Name] [Flat] [Name] [Phone]
        // Example: Block A 101 Jaydeep 9876543210
        // Or user's prompt example: Block A | 408 | Jaydeep | ... (which implies separators)
        // Or user's code assumption: Block Flat Name Phone (4 parts)
        
        // Robust Parsing Strategy:
        // 1. Split by spaces
        let parts = line.split(/\s+/);
        
        // 2. Remove "Block" keyword if present at start
        if (parts.length > 0 && parts[0].toLowerCase() === 'block') {
            parts.shift();
        }

        // 3. Check length (Need at least Block, Flat, Name)
        if (parts.length < 3) {
            // Not a valid resident line (maybe header/footer)
            continue; 
        }

        const blockName = parts[0];
        const flatNumber = parts[1];
        const name = parts[2]; // Taking first part of name as prompt implies simple logic? 
        // Wait, prompt says "Username -> Resident Name". If name is "Jaydeep Singh", split gives "Jaydeep", "Singh".
        // Code in prompt: `const [block, flat, name, phoneRaw] = parts;` -> This assumes 1-word name.
        // I will try to join the name if possible, but identifying where phone starts is hard without regex.
        // I'll stick to the "first name only" or "name is one word" assumption from the user's code for safety, 
        // OR better: use regex if it matches, else fallback to split.
        
        let phoneRaw = parts.length > 3 ? parts[parts.length - 1] : null;
        // If phone is not digits, maybe it's part of name?
        // Let's stick to the prompt's split logic but slightly improved.
        
        // Re-implementing prompt logic mostly:
        // const [block, flat, name, phoneRaw] = parts;
        
        // To be safe with "Block A":
        // blockName is parts[0] (which is "A" after shift)
        
        // Validation:
        const block = blocks.find(b => b.name.toLowerCase() === blockName.toLowerCase());
        if (!block) {
            skipped++;
            // errors.push(`Block ${blockName} not found`); // Optional: don't spam errors for header lines
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

        // Name handling: Try to capture full name if possible
        // If parts has more than 3 elements (Block, Flat, Name... Phone?)
        // If the last element looks like a phone, treat it as phone.
        let residentName = name;
        let phone = null;
        
        // Simple heuristic: 
        if (parts.length > 3) {
             const lastPart = parts[parts.length - 1];
             if (/^(\+?[\d\-\s]+)$/.test(lastPart) && lastPart.replace(/\D/g, '').length > 5) {
                 phoneRaw = lastPart;
                 residentName = parts.slice(2, parts.length - 1).join(" ");
             } else {
                 residentName = parts.slice(2).join(" "); // No phone
                 phoneRaw = null;
             }
        }

        if (phoneRaw) {
             phone = phoneRaw.replace(/\D/g, "");
        }

        // Username & Password
        const username = residentName.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (existingUsernames.has(username)) {
             skipped++;
             errors.push(`Username ${username} taken`);
             continue;
        }

        const passwordRaw = residentName.slice(0, 4).toLowerCase() + (phone ? phone.slice(-2) : "00");
        const hashedPassword = await bcrypt.hash(passwordRaw, 10);

        // Firestore Write (Project Schema)
        const ref = residencyRef.collection("residents").doc(username);
        batch.set(ref, {
          username,
          password: hashedPassword,
          phone: phone ? `+91${phone}` : null, // Assuming +91 as per prompt
          flatId: flat.id,
          active: true,
          createdAt: new Date().toISOString(),
          // Metadata for admin
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

      } catch (e) {
        skipped++;
        errors.push(e.message);
      }
    }

    if (batchCount > 0) {
        await batch.commit();
    }

    return res.status(200).json({
      success: true,
      created,
      skipped,
      errors,
    });

  } catch (fatal) {
    console.error("Fatal Error:", fatal);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: fatal.message,
    });
  }
}
