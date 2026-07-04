'use client';
import { useEffect } from 'react';

// Registra o service worker (PWA). O SW cuida do app shell e da fila offline.
export function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
