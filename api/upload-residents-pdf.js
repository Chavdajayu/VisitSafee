import admin from "firebase-admin";
import Busboy from "busboy";
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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  initAdmin();
  if (!admin.apps.length) {
    return res.status(500).json({ error: "Server configuration missing" });
  }

  const db = admin.firestore();
  const busboy = Busboy({ headers: req.headers });
  
  const fileBuffer = [];
  let residencyId = null;

  busboy.on("field", (fieldname, val) => {
    if (fieldname === "residencyId") residencyId = val;
  });

  busboy.on("file", (fieldname, file, info) => {
    file.on("data", (data) => {
      fileBuffer.push(data);
    });
  });

  busboy.on("finish", async () => {
    if (!residencyId) {
      return res.status(400).json({ error: "Missing residencyId" });
    }
    if (fileBuffer.length === 0) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const buffer = Buffer.concat(fileBuffer);
      const data = await pdf(buffer);
      const text = data.text;

      // Parse lines
      const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      const entries = [];
      
      // Regex: Block [Name] [FlatNumber] [Resident Name] [Phone(optional)]
      const regex = /Block\s+(.+?)\s+(\d+)\s+(.+?)(?:\s+(\+?[\d\s\-]+))?$/i;

      for (const line of lines) {
         const match = line.match(regex);
         if (match) {
            entries.push({
               blockName: match[1].trim(),
               flatNumber: match[2].trim(),
               name: match[3].trim(),
               phone: match[4] ? match[4].trim() : null
            });
         }
      }

      if (entries.length === 0) {
          return res.status(400).json({ error: "No valid entries found in PDF. Format: Block [Name] [Flat] [Name] [Phone]" });
      }

      // 1. Fetch Reference Data
      const residencyRef = db.collection("residencies").doc(residencyId);
      
      const [blocksSnap, flatsSnap, residentsSnap] = await Promise.all([
        residencyRef.collection("blocks").get(),
        residencyRef.collection("flats").get(),
        residencyRef.collection("residents").get()
      ]);

      const blocks = blocksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const flats = flatsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      
      const existingUsernames = new Set(residentsSnap.docs.map(d => d.data().username));
      const occupiedFlatIds = new Set(residentsSnap.docs.map(d => d.data().flatId));

      let batch = db.batch();
      let count = 0;
      let skipped = 0;
      let failed = 0;
      const details = [];
      const maxBatchSize = 450;
      let batchCount = 0;

      for (const entry of entries) {
        try {
            // Validate Block
            const entryBlockName = entry.blockName.trim();
            const block = blocks.find(b => b.name.toLowerCase() === entryBlockName.toLowerCase()) || 
                          blocks.find(b => b.name.toLowerCase() === `block ${entryBlockName.toLowerCase()}`) ||
                          blocks.find(b => b.name.toLowerCase().endsWith(` ${entryBlockName.toLowerCase()}`));

            if (!block) {
                skipped++;
                details.push({ ...entry, status: 'skipped', reason: `Block '${entry.blockName}' not found` });
                continue;
            }

            // Validate Flat
            const flat = flats.find(f => f.blockId === block.id && f.number === entry.flatNumber.toString());
            if (!flat) {
                skipped++;
                details.push({ ...entry, status: 'skipped', reason: `Flat '${entry.flatNumber}' not found` });
                continue;
            }

            // Check Occupancy
            if (occupiedFlatIds.has(flat.id)) {
                skipped++;
                details.push({ ...entry, status: 'skipped', reason: `Flat '${entry.flatNumber}' occupied` });
                continue;
            }

            // Generate Username
            const firstName = entry.name.trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
            const username = firstName;

            if (!username || existingUsernames.has(username)) {
                // Try appending numbers if taken? Prompt says "Check if exists -> Skip"
                skipped++;
                details.push({ ...entry, status: 'skipped', reason: `Username '${username}' taken/invalid` });
                continue;
            }

            // Generate Password
            const namePart = entry.name.trim().toLowerCase().replace(/[^a-z]/g, '').substring(0, 4);
            let phonePart = "00";
            if (entry.phone) {
                const digits = entry.phone.replace(/[^0-9]/g, '');
                if (digits.length >= 2) {
                    phonePart = digits.substring(digits.length - 2);
                }
            }
            const rawPassword = `${namePart}${phonePart}`;
            const hashedPassword = await bcrypt.hash(rawPassword, 10);

            // Add to Batch
            const ref = residencyRef.collection("residents").doc(username);
            batch.set(ref, {
                username,
                password: hashedPassword, // Storing HASHED password
                phone: entry.phone || null,
                flatId: flat.id,
                active: true,
                createdAt: new Date().toISOString()
            });

            existingUsernames.add(username);
            occupiedFlatIds.add(flat.id);
            
            count++;
            batchCount++;

            if (batchCount >= maxBatchSize) {
                await batch.commit();
                batch = db.batch();
                batchCount = 0;
            }

        } catch (err) {
            console.error("Entry Error:", err);
            failed++;
            details.push({ ...entry, status: 'failed', reason: err.message });
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }

      res.status(200).json({ created: count, skipped, failed, details });

    } catch (err) {
        console.error("Processing Error:", err);
        res.status(500).json({ error: "Failed to process PDF: " + err.message });
    }
  });

  req.pipe(busboy);
}
