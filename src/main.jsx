import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
// Inter bundled with the app (works offline; previously loaded from Google Fonts).
// Same weights as before; each file only downloads the character sets a page uses.
import '@fontsource/inter/300.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './AppContext.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { registerSW } from 'virtual:pwa-register';
import { isCriticalWorkInProgress } from './services/busyGuard';

// Force unregister all service workers in development mode to prevent infinite reload loops
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (let registration of registrations) {
        registration.unregister();
        console.log('Unregistered dev service worker');
      }
    });
  }
} else {
  // Register the PWA service worker for production.
  // registerType is 'autoUpdate': a new version activates by itself. By default the plugin
  // then reloads the page immediately, which could interrupt a sale being sent. Instead we
  // wait until no sale/sync/return is in progress (carts are kept in localStorage).
  // Also wait until nobody has typed, scanned or clicked for a short while, so an update
  // never reloads the page in the middle of someone's work at the counter.
  const IDLE_BEFORE_RELOAD_MS = 20 * 1000;
  let lastActivity = Date.now();
  ['keydown', 'pointerdown', 'touchstart', 'input'].forEach((evt) =>
    window.addEventListener(evt, () => { lastActivity = Date.now(); }, { capture: true, passive: true })
  );
  const reloadWhenIdle = () => {
    if (isCriticalWorkInProgress() || Date.now() - lastActivity < IDLE_BEFORE_RELOAD_MS) {
      setTimeout(reloadWhenIdle, 2000);
      return;
    }
    window.location.reload();
  };

  registerSW({
    onNeedReload: reloadWhenIdle,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Look for a new deployment: when the tab comes back into view or the window gets
      // focus (at most once every 2 minutes), and every 15 minutes while it stays open.
      let lastCheck = 0;
      const checkForUpdate = () => {
        if (!navigator.onLine) return;
        const now = Date.now();
        if (now - lastCheck < 2 * 60 * 1000) return;
        lastCheck = now;
        registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
      });
      window.addEventListener('focus', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
      setInterval(checkForUpdate, 15 * 60 * 1000);
    },
    onOfflineReady() {
      console.log('App is ready to work offline.');
    },
  });
}

// The app started: tell the safety net in index.html, and allow a future recovery again.
window.__posBooted = true;
try { sessionStorage.removeItem('pos_boot_recovery'); } catch { /* ignore */ }

// A lazily loaded part of the app from the previous version is gone after a deploy:
// reload once to get the new version (guarded so it can't loop).
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  try {
    if (sessionStorage.getItem('pos_chunk_reload')) return;
    sessionStorage.setItem('pos_chunk_reload', '1');
  } catch { /* ignore */ }
  if (!isCriticalWorkInProgress()) window.location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes fresh data
      refetchOnWindowFocus: false, // Prevent jarring refetches when switching desktop windows
      retry: 1, // Single fast retry on transient network failures
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </AppProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);