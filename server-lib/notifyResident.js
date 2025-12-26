import { db } from './firebaseAdmin.js';
import { sendPushNotification } from './notificationService.js';

function normalizeBlockName(name) {
    if (!name) return "";
    const n = String(name).trim().toUpperCase();
    // If it's just a letter "A", return "BLOCK A"
    if (/^[A-Z]$/.test(n)) return `BLOCK ${n}`;
    // If it's "BLOCK A", return "BLOCK A"
    return n;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { residencyId, flatId, visitorName, visitorId } = req.body;

  if (!residencyId || !flatId || !visitorName || !visitorId) {
    console.error('Missing required fields for notification:', { residencyId, flatId, visitorName, visitorId });
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    console.log(`Processing visitor notification for Flat ${flatId} in Residency ${residencyId}`);

    const residentsRef = db().collection('residencies').doc(residencyId).collection('residents');
    const residentsMap = new Map(); // Use Map to deduplicate by ID

    // STRATEGY 1: Find residents linked directly by flatId
    const snapshotById = await residentsRef.where('flatId', '==', flatId).get();
    snapshotById.forEach(doc => residentsMap.set(doc.id, doc));

    // STRATEGY 2: Find residents linked by Block Name + Flat Number (Legacy/Imported)
    // We need to fetch the Flat and Block details first to know what to search for
    try {
        const flatDoc = await db().collection('residencies').doc(residencyId).collection('flats').doc(flatId).get();
        
        if (flatDoc.exists) {
            const flatData = flatDoc.data();
            const flatNumber = String(flatData.number);
            const blockId = flatData.blockId;

            if (blockId) {
                const blockDoc = await db().collection('residencies').doc(residencyId).collection('blocks').doc(blockId).get();
                
                if (blockDoc.exists) {
                    const blockData = blockDoc.data();
                    const blockName = blockData.name; // e.g. "Block A" or "A"

                    // We need to match how residents are stored.
                    // Residents usually have "Block A" or "A" in the 'block' field.
                    // Let's try to query for both raw and normalized.
                    
                    // Note: Firestore doesn't support logical OR in a single query well for multiple fields mixed with AND.
                    // So we run parallel queries.
                    
                    const normalizedBlock = normalizeBlockName(blockName);
                    
                    // Query A: flat == "101" AND block == "Block A"
                    const q1 = residentsRef
                        .where('flat', '==', flatNumber)
                        .where('block', '==', normalizedBlock)
                        .get();

                    // Query B: flat == "101" AND block == "A" (if different)
                    let q2 = Promise.resolve({ empty: true, docs: [] });
                    if (blockName.toUpperCase() !== normalizedBlock) {
                         q2 = residentsRef
                            .where('flat', '==', flatNumber)
                            .where('block', '==', blockName)
                            .get();
                    }

                    // Run queries
                    const [snap1, snap2] = await Promise.all([q1, q2]);

                    snap1.forEach(doc => residentsMap.set(doc.id, doc));
                    snap2.forEach(doc => residentsMap.set(doc.id, doc));
                }
            }
        }
    } catch (lookupError) {
        console.error("Error looking up flat/block details:", lookupError);
        // Continue with whatever residents we found by ID
    }

    if (residentsMap.size === 0) {
      console.log(`No residents found for Flat ${flatId}`);
      return res.status(200).json({ success: true, message: 'No residents found for this flat' });
    }

    console.log(`Found ${residentsMap.size} residents for Flat ${flatId}`);

    // 2. Send notification to each resident
    const notifications = [];
    
    for (const doc of residentsMap.values()) {
      const residentId = doc.id;
      const residentData = doc.data();

      // Skip if no token (optimization, though sendPushNotification checks too)
      if (!residentData.fcmToken && !residentData.fcmTokens) {
          console.log(`Skipping resident ${residentId} (no tokens)`);
          continue;
      }

      const notificationPayload = {
        title: 'New Visitor Request',
        body: `A visitor (${visitorName}) is requesting entry to your flat. Please approve or reject.`
      };

      const dataPayload = {
        type: 'VISITOR_REQUEST',
        visitorId: visitorId, // This is the request ID
        requestId: visitorId, // Add alias for clarity/compatibility
        residencyId: residencyId,
        residentUsername: residentId,
        url: `/resident?requestId=${visitorId}` // Helper for click action
      };

      // We await here to ensure we don't overwhelm if there are many, 
      // but usually there are 1-4 residents per flat.
      const result = await sendPushNotification(
        residencyId, 
        residentId, 
        'resident', 
        notificationPayload, 
        dataPayload
      );
      
      notifications.push({ residentId, result });
    }

    console.log('Notification results:', notifications);
    return res.status(200).json({ success: true, notifications });

  } catch (error) {
    console.error('Error in notifyResident:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
