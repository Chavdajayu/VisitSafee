import { db } from './firebaseAdmin.js';
import { sendPushNotification } from './notificationService.js';

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

    // 1. Find residents linked to this flat
    const residentsRef = db().collection('residencies').doc(residencyId).collection('residents');
    const snapshot = await residentsRef.where('flatId', '==', flatId).get();

    if (snapshot.empty) {
      console.log(`No residents found for Flat ${flatId}`);
      return res.status(200).json({ success: true, message: 'No residents found for this flat' });
    }

    console.log(`Found ${snapshot.size} residents for Flat ${flatId}`);

    // 2. Send notification to each resident
    const notifications = [];
    
    for (const doc of snapshot.docs) {
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
        visitorId: visitorId,
        residencyId: residencyId,
        residentUsername: residentId
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
