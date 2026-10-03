import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import { MobileScannerModal, ProductInfoModal } from './AppModals';
import { AlertDialog, ConfirmDialog } from './Dialog';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from './AppContext';
import { startBackgroundSync, stopBackgroundSync } from './services/sync';
import { WifiOff, ScanBarcode, LayoutDashboard, Printer, Moon, Sun, LogOut } from 'lucide-react';

import { useQuery } from '@tanstack/react-query';

function App() {
  const {
    shopSettings, setShopSettings,
    userRole, setUserRole,
    cashierName, setCashierName,
    isDarkMode, toggleDarkMode, setDarkMode,
    alertConfig, showAlert, closeAlert,
    confirmConfig, handleConfirm, closeConfirm,
  } = useApp();

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncCount, setSyncCount] = useState(0);

  const navigate = useNavigate();
  const location = useLocation();

  const { data: workerData, error: workerError } = useQuery({
    queryKey: ['workerPermissions', cashierName],
    queryFn: async () => {
      if (!cashierName || userRole === 'owner') return null;
      const { data, error } = await supabase.from('workers').select('password').eq('name', cashierName).single();
      if (error) throw error;
      return data;
    },
    enabled: !!cashierName && userRole !== 'owner',
    retry: false, // Do not retry if the worker was deleted
  });

  useEffect(() => {
    // PGRST116 means 0 rows returned for a .single() query, meaning the worker was deleted
    if (workerError && workerError.code === 'PGRST116') {
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

    // Fluid scaling: perfectly matches UI proportions across any browser/zoom
    const handleResize = () => {
      const baseWidth = 1440; // The Mac viewport width they consider "normal"
      const currentWidth = window.innerWidth;
      if (currentWidth < baseWidth) {
        // Proportionally scale down base font size
        const newSize = (currentWidth / baseWidth) * 16;
        document.documentElement.style.fontSize = `${Math.max(10, newSize)}px`;
      } else {
        document.documentElement.style.fontSize = '16px';
      }
    };
    window.addEventListener('resize', handleResize);
    handleResize(); // Initial scale

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
      window.removeEventListener('resize', handleResize);
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
    const link = document.getElementById('app-favicon');

    if (!shopSettings?.shop_name) {
      document.title = 'Hardware POS System';
      if (link) link.href = 'data:image/x-icon;,';
      return;
    }

    document.title = shopSettings.shop_name;
    const logoSrc = shopSettings?.logo_url || '/logo.png';
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      if (link) link.href = canvas.toDataURL('image/png');
    };
    img.src = logoSrc;
  }, [shopSettings?.shop_name, shopSettings?.logo_url]);

  const fetchInitialData = useCallback(async () => {
    try {
      setIsInitialLoad(true);
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
        } else {
          currentShop = settingsData;
          setShopSettings(settingsData);
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
      <EntryFlow
        onLoginSuccess={handleLoginSuccess}
        isSetupNeeded={isSetupNeeded}
        onSetupComplete={(s) => { setShopSettings(s); setIsSetupNeeded(false); }}
        shopSettings={shopSettings}
      />
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
        className="w-full md:w-auto shadow-sm h-[56px] md:h-[60px] flex-shrink-0 relative z-[9999] print:hidden md:mx-4 md:my-4 md:rounded-xl border-b md:border border-[var(--border-medium)] md:border-[var(--border-light)]"
        style={{
          backgroundColor: 'var(--bg-secondary)',
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="w-full flex items-center justify-between h-full">
          <div
            className="h-full flex items-center justify-center flex-shrink-0 px-4 md:px-0 w-auto md:w-[16.5rem]"
          >
            <span
              className="text-sm font-bold uppercase tracking-wider truncate text-center w-full"
              style={{ color: 'var(--text-primary)' }}
            >
              {cashierName}
            </span>
          </div>

          <div className="flex-1 flex items-center justify-end gap-2 md:gap-3 h-full pl-2 pr-4 md:pl-4 overflow-x-auto hide-scrollbar" style={{ scrollbarWidth: 'none' }}>
            {!isOnline && (
              <div className="flex items-center gap-1 text-xs font-bold px-2 py-1 bg-[var(--color-error)] text-white mr-auto animate-pulse whitespace-nowrap shrink-0">
                <WifiOff size={16} />
                <span className="hidden md:inline">OFFLINE MODE</span>
              </div>
            )}




            {userRole === 'owner' && (
              <>
                <button
                  onClick={() => navigate('/owner/dashboard')}
                  className="h-11 w-11 md:h-auto md:w-auto rounded-md md:px-6 md:py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none transition-colors shrink-0 flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: location.pathname.startsWith('/owner') ? 'var(--color-accent)' : 'var(--bg-secondary)',
                    color: location.pathname.startsWith('/owner') ? 'var(--color-accent-fg)' : 'var(--text-primary)',
                    border: `1px solid ${location.pathname.startsWith('/owner') ? 'var(--color-accent)' : 'var(--border-medium)'}`,
                  }}
                >
                  <span className="hidden md:inline">Management</span>
                  <LayoutDashboard size={18} className="md:hidden" />
                </button>
                <div className="h-8 w-px mx-1" style={{ backgroundColor: 'var(--border-medium)' }} />
              </>
            )}



            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="h-10 w-auto md:h-9 md:w-auto rounded-md px-3 md:px-6 text-white text-xs font-bold uppercase tracking-wider transition-colors focus:outline-none shrink-0 flex items-center justify-center gap-2 border bg-[var(--color-error)] border-[var(--color-error)] hover:bg-[#c90f1f] hover:border-[#c90f1f]"
            >
              <span className="hidden md:inline">Sign Out</span>
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main
        className="flex-1 w-full md:px-4 md:pb-4 overflow-y-auto relative z-10 print:static"
        role="main"
        aria-label="Application content"
      >
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
      </main>
    </div>
  );
}

export default App;