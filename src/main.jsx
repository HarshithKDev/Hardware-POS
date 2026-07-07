import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './AppContext.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { registerSW } from 'virtual:pwa-register';

// Register the PWA service worker
const updateSW = registerSW({
  onNeedRefresh() {
    // We can add a toast here later to ask user to refresh
    console.log('New content available, refresh to update.');
  },
  onOfflineReady() {
    console.log('App is ready to work offline.');
  },
});

const queryClient = new QueryClient();

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