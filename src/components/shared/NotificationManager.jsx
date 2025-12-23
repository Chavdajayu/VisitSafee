import { useEffect } from 'react';
import { useAuth } from "@/hooks/use-auth.jsx";
import { messaging } from '@/lib/firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { storage } from '@/lib/storage';
import { useToast } from "@/hooks/use-toast";

export function NotificationManager() {
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    // Only request if user is logged in
    if (!user) return;

    const setupToken = async () => {
        // Wait for service worker to be ready
        if (!('serviceWorker' in navigator)) return;
        
        try {
            const registration = await navigator.serviceWorker.ready;
            
            if (messaging) {
                 const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
                 const token = await getToken(messaging, { 
                    serviceWorkerRegistration: registration,
                    vapidKey
                 });
                 if (token) {
                     // console.log('FCM Token:', token);
                     await storage.saveUserToken(token);
                 }
            }
        } catch (error) {
            console.error('Error setting up notification token:', error);
        }
    };

    const requestPermission = async () => {
      try {
        if (!('Notification' in window)) {
          console.log('This browser does not support desktop notification');
          return;
        }

        if (Notification.permission === 'default') {
          // Request permission with user gesture via Toast
          toast({
            title: "Enable Notifications",
            description: "Tap to receive real-time visitor alerts even when app is closed.",
            action: (
              <button 
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                onClick={async () => {
                 const permission = await Notification.requestPermission();
                 if (permission === 'granted') {
                   await setupToken();
                 }
              }}>
                Enable
              </button>
            ),
            duration: Infinity,
          });
        } else if (Notification.permission === 'granted') {
           await setupToken();
        }
      } catch (error) {
        console.error('Error requesting notification permission:', error);
      }
    };

    requestPermission();

    // Foreground notifications: show a native notification when app is open
    // FCM doesn't display notifications automatically in foreground
    if (messaging) {
      const unsubscribe = onMessage(messaging, async (payload) => {
        try {
          const registration = await navigator.serviceWorker.ready;
          const title = payload.notification?.title || payload.data?.title || 'VisitSafe';
          const options = {
            body: payload.notification?.body || payload.data?.body,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            data: payload.data || {},
          };
          await registration.showNotification(title, options);
        } catch (e) {
          // Fallback to toast if Notification API not available
          toast({
            title: payload.notification?.title || 'VisitSafe',
            description: payload.notification?.body || 'New notification',
          });
        }
      });
      return () => unsubscribe();
    }
  }, [user, toast]);

  return null;
}
