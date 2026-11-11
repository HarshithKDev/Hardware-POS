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
  const reloadWhenIdle = () => {
    if (isCriticalWorkInProgress()) {
      setTimeout(reloadWhenIdle, 2000);
      return;
    }
    window.location.reload();
  };

  registerSW({
    onNeedReload: reloadWhenIdle,
    onRegisteredSW(_swUrl, registration) {
      // Counters stay open all day: check for a new deployment every hour
      if (registration) {
        setInterval(() => {
          if (navigator.onLine) registration.update().catch(() => {});
        }, 60 * 60 * 1000);
      }
    },
    onOfflineReady() {
      console.log('App is ready to work offline.');
    },
  });
}

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