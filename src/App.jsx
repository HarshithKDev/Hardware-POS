import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Spinner, PageLoader } from './SharedUI';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';
import { LogoutModal, MobileScannerModal, ProductInfoModal } from './AppModals';
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
    alertConfig, closeAlert,
    confirmConfig, handleConfirm, closeConfirm,
  } = useApp();

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const navigate = useNavigate();
  const location = useLocation();

  const { data: workerData } = useQuery({
    queryKey: ['workerPermissions', cashierName],
    queryFn: async () => {
      if (!cashierName || cashierName === 'owner') return null;
      const { data } = await supabase.from('workers').select('password').eq('name', cashierName).single();
      return data;
    },
    enabled: !!cashierName && cashierName !== 'owner',
  });

  const isBillable = cashierName === 'owner' || (workerData && !workerData.password?.includes('NON_BILLABLE'));

  useEffect(() => { fetchInitialData(); }, []);

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

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    if (userRole) {
      startBackgroundSync();
    }
    return () => stopBackgroundSync();
  }, [userRole]);

  useEffect(() => {
    if (shopSettings?.shop_name) {
      document.title = shopSettings.shop_name;
    } else {
      document.title = 'Hardware POS System';
    }
  }, [shopSettings?.shop_name]);

  const fetchInitialData = async () => {
    try {
      setIsInitialLoad(true);
      const { data: settingsData, error: settingsError } = await supabase
        .from('shop_settings')
        .select('*')
        .limit(1);

      if (settingsError && settingsError.code !== 'PGRST116') throw settingsError;

      if (!settingsData || settingsData.length === 0) {
        setIsSetupNeeded(true);
      } else {
        setShopSettings(settingsData[0]);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const savedRole = sessionStorage.getItem('posUserRole') || localStorage.getItem('posUserRole');
        if (savedRole) {
          setUserRole(savedRole);
          const displayName = savedRole === 'owner'
            ? (settingsData?.[0]?.owner_name || 'Administrator')
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
  };

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
        className="w-full min-h-screen flex flex-col items-center justify-center"
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
      className="w-full h-screen flex flex-col overflow-hidden"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
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
      />

      {/* MODALS */}
      {showLogoutConfirm && (
        <LogoutModal
          onConfirm={confirmLogout}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}

      {isMobileScannerOpen && (
        <MobileScannerModal
          onClose={() => setIsMobileScannerOpen(false)}
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
        className="w-full shadow-sm h-[56px] md:h-[60px] flex-shrink-0 relative z-[9999]"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-medium)',
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
            {isBillable && (
              <button
                onClick={() => setIsMobileScannerOpen(true)}
                className="md:hidden h-11 w-11 rounded-md focus:outline-none shrink-0 flex items-center justify-center"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-medium)',
                }}
                aria-label="Open barcode scanner"
              >
                <ScanBarcode size={18} />
              </button>
            )}

            {userRole === 'owner' && (
              <>
                <button
                  onClick={() => navigate('/owner/dashboard')}
                  className="h-11 w-11 md:h-auto md:w-auto rounded-md md:px-6 md:py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none transition-colors shrink-0 flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: location.pathname.startsWith('/owner') ? 'var(--color-accent)' : 'var(--bg-secondary)',
                    color: location.pathname.startsWith('/owner') ? '#ffffff' : 'var(--text-primary)',
                    border: `1px solid ${location.pathname.startsWith('/owner') ? 'var(--color-accent)' : 'var(--border-medium)'}`,
                  }}
                >
                  <span className="hidden md:inline">Management</span>
                  <LayoutDashboard size={18} className="md:hidden" />
                </button>
                <button
                  onClick={() => navigate('/printer')}
                  className="h-11 w-11 md:h-auto md:w-auto rounded-md md:px-6 md:py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none transition-colors shrink-0 flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: location.pathname.startsWith('/printer') ? 'var(--color-accent)' : 'var(--bg-secondary)',
                    color: location.pathname.startsWith('/printer') ? '#ffffff' : 'var(--text-primary)',
                    border: `1px solid ${location.pathname.startsWith('/printer') ? 'var(--color-accent)' : 'var(--border-medium)'}`,
                  }}
                >
                  <span className="hidden md:inline">Barcodes</span>
                  <Printer size={18} className="md:hidden" />
                </button>
                <div className="h-8 w-px mx-1" style={{ backgroundColor: 'var(--border-medium)' }} />
              </>
            )}

            {/* Dark Mode Toggle */}
            {isBillable && (
              <button
                onClick={toggleDarkMode}
                className="h-11 w-11 md:h-auto md:w-auto rounded-md md:px-3 md:py-2 transition-colors flex items-center justify-center focus:outline-none focus:ring-1 shrink-0"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-medium)',
                }}
                title="Toggle Dark Mode"
                aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDarkMode ? (
                  <Sun size={18} />
                ) : (
                  <Moon size={18} />
                )}
              </button>
            )}

            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="h-11 w-11 md:h-9 md:w-auto rounded-md md:px-6 text-white text-xs font-bold uppercase tracking-wider transition-colors focus:outline-none shrink-0 flex items-center justify-center gap-2 border bg-[var(--color-error)] border-[var(--color-error)] hover:bg-[#c90f1f] hover:border-[#c90f1f]"
            >
              <span className="hidden md:inline">Sign Out</span>
              <LogOut size={16} className="md:hidden" />
            </button>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main
        className="flex-1 w-full p-4 md:p-6 overflow-y-auto relative z-10"
        role="main"
        aria-label="Application content"
      >
        <Routes>
          {userRole === 'owner' && (
            <>
              <Route path="/owner/:tab" element={<OwnerDashboard />} />
              <Route path="/owner" element={<Navigate to="/owner/dashboard" replace />} />
              <Route path="/printer" element={<BarcodePrinter />} />
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