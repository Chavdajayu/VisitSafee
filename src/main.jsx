import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Register Service Worker in production
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(error => {
      console.log('SW registration failed:', error);
    });
  });
}

createRoot(document.getElementById("root")).render(<App />);
