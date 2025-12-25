import { useEffect, useState } from 'react';
import { useAuth } from "@/hooks/use-auth.jsx";
import { messaging } from '@/lib/firebase';
import { getToken, onMessage } from 'firebase/messaging';
import { storage } from '@/lib/storage';
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function NotificationManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [active, setActive] = useState(null);
  const [seen, setSeen] = useState(() => new Set());

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

    // Foreground messages
    if (messaging) {
      const unsubscribe = onMessage(messaging, async (payload) => {
        try {
          // Show system notification even when app is open
          if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            const { title, body, icon } = payload.notification || {};
            const { visitorName, requestId, actionUrlApprove, actionUrlReject } = payload.data || {};
            
            registration.showNotification(title || "New Visitor Request", {
              body: body || `${visitorName} wants to visit`,
              icon: icon || "/icons/visitor.png",
              badge: "/icons/badge.png",
              tag: requestId ? `req-${requestId}` : undefined,
              data: payload.data,
              requireInteraction: true,
              actions: [
                  { action: "APPROVE", title: "Approve" },
                  { action: "REJECT", title: "Reject" }
              ]
            });
          }

          const rid = payload.data?.requestId;
          if (rid && !seen.has(rid)) {
            setSeen(prev => {
              const n = new Set(prev);
              n.add(rid);
              return n;
            });
            setActive({
              requestId: rid,
              visitorName: payload.data?.visitorName,
              phone: payload.data?.phone,
              purpose: payload.data?.purpose,
              block: payload.data?.block,
              flat: payload.data?.flat
            });
          }
        } catch (e) {
          // ignore
        }
      });
      return () => unsubscribe();
    }
  }, [user, toast]);

  const act = async (action) => {
    if (!active) return;
    try {
      const res = await fetch(`/api/visitor-action?action=${action}&residencyId=${user?.residencyId}&requestId=${active.requestId}`, { method: "POST" });
      if (res.ok) setActive(null);
    } catch {}
  };

  if (!active) return null;

  return (
    <div className="fixed inset-x-0 top-20 z-50 px-4">
      <Card className="w-full bg-white shadow-lg border rounded-xl p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <div className="text-slate-900 font-semibold text-base">
              {active.visitorName}
            </div>
            <div className="text-slate-600 text-sm">
              {active.phone}
            </div>
            <div className="text-slate-700 text-sm">
              {active.purpose}
            </div>
            <div className="text-slate-800 text-sm font-medium">
              {active.block ? `${active.block} • Flat ${active.flat}` : (active.flat ? `Flat ${active.flat}` : "")}
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={() => act("approve")}>Approve</Button>
            <Button variant="destructive" onClick={() => act("reject")}>Reject</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
