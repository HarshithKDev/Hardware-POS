import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import { MobileScannerModal, ProductInfoModal } from './AppModals';
import { AlertDialog, ConfirmDialog } from './Dialog';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './AppContext';
import { startBackgroundSync, stopBackgroundSync } from './services/sync';
import { WifiOff, ScanBarcode, Moon, Sun, Power } from 'lucide-react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
const EntryFlow = lazy(() => import('./EntryFlow'));

function App() {
  const {
    shopSettings, setShopSettings,
    userRole, setUserRole,
    cashierName, setCashierName,
    isDarkMode, toggleDarkMode, setDarkMode,
    alertConfig, showAlert, closeAlert,
    confirmConfig, handleConfirm, closeConfirm,
  } = useApp();

  const [isInitialLoad, setIsInitialLoad] = useState(() => {
    // If shop settings are cached, avoid initial loading spinner block for instant cold start
    return !localStorage.getItem('cached_shop_settings');
  });
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncCount, setSyncCount] = useState(0);
  const manifestBlobUrlRef = useRef(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  const savedShopId = localStorage.getItem('shop_id');

  const { data: workerData, error: workerError } = useQuery({
    queryKey: ['workerPermissions', savedShopId, cashierName],
    queryFn: async () => {
      if (!cashierName || userRole === 'owner') return null;
      let query = supabase.from('workers').select('password').eq('name', cashierName);
      if (savedShopId) {
        query = query.eq('shop_id', savedShopId);
      }
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!cashierName && userRole !== 'owner',
    retry: false, // Do not retry if the worker was deleted
  });

  useEffect(() => {
    // PGRST116 means 0 rows returned for a .single() query, meaning the worker was deleted
    if (workerError && workerError.code === 'PGRST116') {
      queryClient.clear();
      setUserRole(null);
      setCashierName('');
      sessionStorage.removeItem('posUserRole');
      localStorage.removeItem('posUserRole');
      navigate('/');
      setTimeout(() => showAlert("Your worker account was deleted or modified. You have been logged out.", "Session Expired"), 100);
    }
  }, [workerError, navigate, setUserRole, setCashierName, showAlert]);

  const isBillable = userRole === 'owner' || (workerData && !workerData.password?.includes('NON_BILLABLE'));



  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Keep base font-size normalized at standard 16px to prevent layout distortion on Windows screens
    document.documentElement.style.fontSize = '16px';

    const handleSyncStart = (e) => {
      setIsSyncing(true);
      if (e.detail?.count) setSyncCount(e.detail.count);
    };
    const handleSyncEnd = () => {
      setIsSyncing(false);
      setSyncCount(0);
    };
    window.addEventListener('queue_sync_start', handleSyncStart);
    window.addEventListener('queue_sync_end', handleSyncEnd);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('queue_sync_start', handleSyncStart);
      window.removeEventListener('queue_sync_end', handleSyncEnd);
    };
  }, []);

  useEffect(() => {
    if (userRole) {
      startBackgroundSync(userRole);
    }
    return () => stopBackgroundSync();
  }, [userRole]);

  useEffect(() => {
    const faviconLink = document.getElementById('app-favicon') || document.querySelector('link[rel="icon"]');
    const appleLink = document.getElementById('app-apple-touch-icon') || document.querySelector('link[rel="apple-touch-icon"]');
    const manifestLink = document.getElementById('app-manifest') || document.querySelector('link[rel="manifest"]');

    if (!shopSettings?.shop_name) {
      document.title = 'Hardware POS System';
      if (faviconLink) faviconLink.href = '/favicon.ico';
      return;
    }

    document.title = shopSettings.shop_name;

    const updateManifest = (iconUrl) => {
      try {
        const dynamicManifest = {
          name: shopSettings.shop_name || 'Hardware POS System',
          short_name: (shopSettings.shop_name || 'Hardware POS').slice(0, 16),
          description: 'Point of Sale & Inventory Management System',
          start_url: '/',
          display: 'standalone',
          theme_color: '#121212',
          background_color: '#121212',
          icons: [
            {
              src: iconUrl,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: iconUrl,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: iconUrl,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        };

        const blob = new Blob([JSON.stringify(dynamicManifest, null, 2)], { type: 'application/manifest+json' });
        const blobUrl = URL.createObjectURL(blob);

        if (manifestBlobUrlRef.current) {
          URL.revokeObjectURL(manifestBlobUrlRef.current);
        }
        manifestBlobUrlRef.current = blobUrl;

        if (manifestLink) {
          manifestLink.href = blobUrl;
        }
      } catch (err) {
        console.error('Failed to inject dynamic manifest:', err);
      }
    };

    const setIcons = (faviconUrl, appleTouchUrl, manifestIconUrl) => {
      if (faviconLink) faviconLink.href = faviconUrl;
      if (appleLink) appleLink.href = appleTouchUrl;
      updateManifest(manifestIconUrl || appleTouchUrl);
    };

    if (shopSettings.logo_url) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          // 1. Favicon (64x64 circular)
          const favCanvas = document.createElement('canvas');
          favCanvas.width = 64;
          favCanvas.height = 64;
          const favCtx = favCanvas.getContext('2d');
          favCtx.beginPath();
          favCtx.arc(32, 32, 32, 0, Math.PI * 2);
          favCtx.closePath();
          favCtx.clip();
          favCtx.drawImage(img, 0, 0, 64, 64);
          const favDataUrl = favCanvas.toDataURL('image/png');

          // 2. Apple Touch Icon (192x192 with #121212 background for clean home screen icon)
          const appleCanvas = document.createElement('canvas');
          appleCanvas.width = 192;
          appleCanvas.height = 192;
          const appleCtx = appleCanvas.getContext('2d');
          appleCtx.fillStyle = '#121212';
          appleCtx.fillRect(0, 0, 192, 192);
          appleCtx.drawImage(img, 0, 0, 192, 192);
          const appleDataUrl = appleCanvas.toDataURL('image/png');

          setIcons(favDataUrl, appleDataUrl, shopSettings.logo_url || appleDataUrl);
        } catch (canvasErr) {
          console.warn('Canvas export tainted by CORS, using direct logo URL for icons:', canvasErr);
          setIcons(shopSettings.logo_url, shopSettings.logo_url, shopSettings.logo_url);
        }
      };
      img.onerror = () => {
        setIcons(shopSettings.logo_url, shopSettings.logo_url, shopSettings.logo_url);
      };
      img.src = shopSettings.logo_url;
    } else {
      // Dynamic avatar when no custom logo is uploaded
      const initial = (shopSettings.shop_name || 'H').trim().charAt(0).toUpperCase();

      // Favicon
      const favCanvas = document.createElement('canvas');
      favCanvas.width = 64;
      favCanvas.height = 64;
      const favCtx = favCanvas.getContext('2d');
      favCtx.fillStyle = '#2563eb';
      favCtx.beginPath();
      favCtx.arc(32, 32, 32, 0, Math.PI * 2);
      favCtx.fill();
      favCtx.fillStyle = '#ffffff';
      favCtx.font = 'bold 34px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      favCtx.textAlign = 'center';
      favCtx.textBaseline = 'middle';
      favCtx.fillText(initial, 32, 34);
      const favDataUrl = favCanvas.toDataURL('image/png');

      // Apple Touch Icon
      const appleCanvas = document.createElement('canvas');
      appleCanvas.width = 192;
      appleCanvas.height = 192;
      const appleCtx = appleCanvas.getContext('2d');
      appleCtx.fillStyle = '#121212';
      appleCtx.fillRect(0, 0, 192, 192);
      appleCtx.fillStyle = '#2563eb';
      const r = 24;
      appleCtx.beginPath();
      appleCtx.moveTo(16 + r, 16);
      appleCtx.lineTo(176 - r, 16);
      appleCtx.quadraticCurveTo(176, 16, 176, 16 + r);
      appleCtx.lineTo(176, 176 - r);
      appleCtx.quadraticCurveTo(176, 176, 176 - r, 176);
      appleCtx.lineTo(16 + r, 176);
      appleCtx.quadraticCurveTo(16, 176, 16, 176 - r);
      appleCtx.lineTo(16, 16 + r);
      appleCtx.quadraticCurveTo(16, 16, 16 + r, 16);
      appleCtx.closePath();
      appleCtx.fill();
      appleCtx.fillStyle = '#ffffff';
      appleCtx.font = 'bold 96px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      appleCtx.textAlign = 'center';
      appleCtx.textBaseline = 'middle';
      appleCtx.fillText(initial, 96, 100);
      const appleDataUrl = appleCanvas.toDataURL('image/png');

      setIcons(favDataUrl, appleDataUrl, appleDataUrl);
    }

    return () => {
      if (manifestBlobUrlRef.current) {
        URL.revokeObjectURL(manifestBlobUrlRef.current);
      }
    };
  }, [shopSettings?.shop_name, shopSettings?.logo_url]);

  const fetchInitialData = useCallback(async () => {
    try {
      const hasCached = !!localStorage.getItem('cached_shop_settings');
      if (!hasCached) {
        setIsInitialLoad(true);
      }
      const savedShopId = localStorage.getItem('shop_id');
      let currentShop = null;

      if (!savedShopId) {
        setIsSetupNeeded(true);
      } else {
        const { data: settingsData, error: settingsError } = await supabase
          .from('shop_settings')
          .select('*')
          .eq('id', savedShopId)
          .single();

        if (settingsError && settingsError.code !== 'PGRST116') {
          throw settingsError;
        }

        if (!settingsData) {
          setIsSetupNeeded(true);
          localStorage.removeItem('shop_id');
          localStorage.removeItem('cached_shop_settings');
        } else {
          currentShop = settingsData;
          setShopSettings(settingsData);
          try {
            localStorage.setItem('cached_shop_settings', JSON.stringify(settingsData));
          } catch (e) {
            console.error('Failed to cache shop settings:', e);
          }
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const savedRole = sessionStorage.getItem('posUserRole') || localStorage.getItem('posUserRole');
        if (savedRole) {
          setUserRole(savedRole);
          const displayName = savedRole === 'owner'
            ? (currentShop?.owner_name || 'Administrator')
            : savedRole;
          setCashierName(displayName);
        }
      } else {
        sessionStorage.removeItem('posUserRole');
        localStorage.removeItem('posUserRole');
      }
    } catch (error) {
      console.error('System Load Error:', error.message);
    } finally {
      setIsInitialLoad(false);
    }
  }, []);

  useEffect(() => { fetchInitialData(); }, [fetchInitialData]);

  const closeMobileScanner = useCallback(() => setIsMobileScannerOpen(false), []);

  const handleLoginSuccess = (role, rememberMe = false) => {
    setUserRole(role);
    if (rememberMe) {
      localStorage.setItem('posUserRole', role);
      sessionStorage.removeItem('posUserRole');
    } else {
      sessionStorage.setItem('posUserRole', role);
      localStorage.removeItem('posUserRole');
    }
    const displayName = role === 'owner'
      ? (shopSettings?.owner_name || 'Administrator')
      : role;
    setCashierName(displayName);
    if (role === 'owner') navigate('/owner/dashboard');
    else navigate('/terminal/dashboard');
  };

  const confirmLogout = async () => {
    await supabase.auth.signOut();
    queryClient.clear();
    setUserRole(null);
    setCashierName('');
    sessionStorage.removeItem('posUserRole');
    localStorage.removeItem('posUserRole');
    setShowLogoutConfirm(false);
    navigate('/');
  };

  if (isInitialLoad) {
    return (
      <div
        className="w-full min-h-[100dvh] flex flex-col items-center justify-center"
        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
      >
        <PageLoader text="Initializing Subsystems" />
      </div>
    );
  }

  if (isSetupNeeded || !userRole) {
    return (
      <Suspense fallback={<div className="w-full min-h-[100dvh] flex items-center justify-center bg-[var(--bg-tertiary)]"><PageLoader text="Loading..." /></div>}>
        <EntryFlow
          onLoginSuccess={handleLoginSuccess}
          isSetupNeeded={isSetupNeeded}
          onSetupComplete={(s) => {
            queryClient.clear();
            setShopSettings(s);
            try {
              localStorage.setItem('cached_shop_settings', JSON.stringify(s));
            } catch (e) {}
            setIsSetupNeeded(false);
          }}
          shopSettings={shopSettings}
        />
      </Suspense>
    );
  }

  return (
    <div
      className="w-full h-[100dvh] flex flex-col overflow-hidden relative"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      {!isOnline && (
        <div className="w-full bg-[var(--color-error)] text-white font-bold text-sm text-center py-1.5 shadow-sm z-[100] animate-pulse">
          Offline Mode: Queuing transactions locally
        </div>
      )}
      {isOnline && isSyncing && (
        <div className="w-full bg-blue-500 text-white font-bold text-sm text-center py-1.5 shadow-sm z-[100]">
          Syncing {syncCount} offline transaction{syncCount !== 1 ? 's' : ''} to server...
        </div>
      )}
      {/* SHARED DIALOGS — rendered from context state */}
      <AlertDialog
        isOpen={alertConfig.isOpen}
        title={alertConfig.title}
        message={alertConfig.message}
        onClose={closeAlert}
      />
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
        confirmLabel={confirmConfig.confirmLabel}
        cancelLabel={confirmConfig.cancelLabel}
        isDestructive={confirmConfig.isDestructive}
      />

      <ConfirmDialog
        isOpen={showLogoutConfirm}
        title="Sign Out"
        message="You will be logged out of the current session. Any unsaved data will be lost. Continue?"
        confirmLabel="Sign Out"
        onConfirm={confirmLogout}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      {isMobileScannerOpen && (
        <MobileScannerModal
          onClose={closeMobileScanner}
          setScannedProduct={setScannedProduct}
        />
      )}

      {scannedProduct && (
        <ProductInfoModal
          product={scannedProduct}
          onClose={() => setScannedProduct(null)}
        />
      )}


      {/* NAVBAR */}
      <nav
        className="w-full md:w-auto shadow-sm h-[46px] md:h-[58px] flex-shrink-0 relative z-[9999] print:hidden md:mx-3 md:my-2 lg:mx-4 lg:my-3 md:rounded-xl border-b md:border border-[var(--border-medium)] md:border-[var(--border-light)]"
        style={{
          backgroundColor: 'var(--bg-secondary)',
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="w-full flex items-center justify-between h-full">
          <div
            className="h-full flex items-center justify-center flex-shrink-0 px-3 md:px-0 w-auto md:w-56"
          >
            <span
              className="text-xs md:text-sm font-bold uppercase tracking-wider truncate text-center w-full px-1 md:px-2"
              style={{ color: 'var(--text-primary)' }}
            >
              {cashierName}
            </span>
          </div>

          <div className="flex-1 min-w-0 flex items-center justify-end gap-1.5 md:gap-3 h-full pl-2 pr-2.5 md:pr-4 overflow-x-hidden md:overflow-x-auto hide-scrollbar" style={{ scrollbarWidth: 'none' }}>
            {!isOnline && (
              <div className="flex items-center gap-1 text-xs font-bold px-2 py-1 bg-[var(--color-error)] text-white mr-auto animate-pulse whitespace-nowrap shrink-0">
                <WifiOff size={16} />
                <span className="hidden md:inline">OFFLINE MODE</span>
              </div>
            )}



            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="h-8 w-8 md:h-9 md:w-auto rounded-md px-0 md:px-4 lg:px-5 text-white text-xs font-bold uppercase tracking-wider transition-colors focus:outline-none shrink-0 flex items-center justify-center gap-2 border bg-[var(--color-error)] border-[var(--color-error)] hover:bg-[#c90f1f] hover:border-[#c90f1f]"
              title="Sign Out"
            >
              <span className="hidden md:inline">Sign Out</span>
              <Power size={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main
        className="flex-1 flex flex-col w-full md:px-3 md:pb-3 lg:px-4 lg:pb-4 overflow-y-auto min-h-0 relative z-10 print:static"
        role="main"
        aria-label="Application content"
      >
        <Suspense fallback={<div className="w-full h-full flex-1 flex flex-col items-center justify-center min-h-[300px] p-8"><PageLoader text="Loading..." /></div>}>
          <Routes>
            {userRole === 'owner' && (
              <>
                <Route path="/owner/:tab" element={<OwnerDashboard />} />
                <Route path="/owner" element={<Navigate to="/owner/dashboard" replace />} />
              </>
            )}
            {userRole && (
              <>
                <Route path="/terminal/:tab" element={<WorkerBilling />} />
                <Route path="/terminal" element={<Navigate to="/terminal/dashboard" replace />} />
              </>
            )}
            <Route path="*" element={<Navigate to={userRole === 'owner' ? "/owner/dashboard" : "/terminal/dashboard"} replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default App;