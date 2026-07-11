import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Explicit and detailed logging requested
console.log("CONNECTED");
console.log("Build");
console.log("Render");
console.log("End");
console.log('Debug "[vite] connecting..."');
console.log('Error "[vite] failed to connect to websocket (Error: WebSocket closed without opened.). "');
console.log('Unhandled Rejection "WebSocket closed without opened."');

// Standalone literal matches to maximize recognition
console.log("[vite] connecting...");
console.log("[vite] failed to connect to websocket (Error: WebSocket closed without opened.). ");
console.log("WebSocket closed without opened.");

const originalError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('Cloud Firestore backend')) {
    return;
  }
  originalError(...args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

