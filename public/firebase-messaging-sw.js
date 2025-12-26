// This file is required by Firebase SDK defaults but our implementation 
// uses service-worker.js to handle both PWA and FCM logic to ensure
// proper configuration injection via URL parameters.
// 
// If this file is ever loaded directly by the browser or SDK, 
// it will try to import the main service worker.

try {
    importScripts('/service-worker.js');
} catch (e) {
    console.error('Failed to import service-worker.js from firebase-messaging-sw.js', e);
}
