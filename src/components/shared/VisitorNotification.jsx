import { useState, useEffect } from 'react';
import { getMessaging, onMessage, getToken } from 'firebase/messaging';
import { useUpdateVisitorStatus } from '@/hooks/use-visitor-requests';
import { storage } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, X, Check } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { motion, AnimatePresence } from 'framer-motion';

export function VisitorNotification() {
  const [notification, setNotification] = useState(null);
  const { mutate: updateStatus } = useUpdateVisitorStatus();
  const { toast } = useToast();

  useEffect(() => {
    const messaging = getMessaging();
    
    // Request permission and get token
    const requestPermission = async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          const token = await getToken(messaging, { 
            vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY 
          });
          if (token) {
            console.log('FCM Token:', token);
            await storage.saveUserToken(token);
          }
        }
      } catch (error) {
        console.error("Error requesting notification permission:", error);
      }
    };
    
    requestPermission();

    // Listen for foreground notifications
    const unsubscribe = onMessage(messaging, (payload) => {
      console.log('Received foreground message', payload);
      if (payload.data && payload.data.requestId) {
        setNotification({
            title: payload.notification.title,
            body: payload.notification.body,
            requestId: payload.data.requestId,
            visitorName: payload.data.visitorName,
            purpose: payload.data.purpose,
            data: payload.data
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const handleAction = async (status) => {
    if (!notification) return;

    try {
      await updateStatus({ 
          id: notification.requestId, 
          status: status 
      });

      toast({
        title: status === 'approved' ? "Visitor Approved" : "Visitor Rejected",
        description: `You have ${status} the request from ${notification.visitorName}.`,
        variant: status === 'approved' ? "default" : "destructive"
      });

      // Close notification
      setNotification(null);
    } catch (error) {
      console.error("Error updating status:", error);
      toast({
        title: "Error",
        description: "Failed to update visitor status.",
        variant: "destructive"
      });
    }
  };

  if (!notification) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0, y: 50, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.9 }}
        className="fixed bottom-4 right-4 z-50 w-full max-w-sm"
      >
        <Card className="shadow-2xl border-primary/20 bg-white/95 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                   <ShieldCheck className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-lg">Visitor Request</CardTitle>
                  <CardDescription>New entry request</CardDescription>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setNotification(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pb-2">
            <div className="space-y-1">
              <p className="font-medium text-base">{notification.visitorName}</p>
              <p className="text-sm text-muted-foreground">{notification.body}</p>
              {notification.purpose && (
                  <p className="text-xs text-slate-500 mt-1">Purpose: {notification.purpose}</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex gap-2 justify-end pt-2">
            <Button 
                variant="outline" 
                size="sm" 
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={() => handleAction('rejected')}
            >
              Reject
            </Button>
            <Button 
                size="sm" 
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => handleAction('approved')}
            >
              <Check className="h-4 w-4 mr-1" />
              Accept
            </Button>
          </CardFooter>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
