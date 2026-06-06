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

function App() {
  const {
    shopSettings, setShopSettings,
    userRole, setUserRole,
    cashierName, setCashierName,
    isDarkMode, toggleDarkMode,
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
        const savedRole = sessionStorage.getItem('posUserRole');
        if (savedRole) {
          setUserRole(savedRole);
          const displayName = savedRole === 'owner'
            ? (settingsData?.[0]?.owner_name || 'Administrator')
            : savedRole;
          setCashierName(displayName);
        }
      } else {
        sessionStorage.removeItem('posUserRole');
      }
    } catch (error) {
      console.error('System Load Error:', error.message);
    } finally {
      setIsInitialLoad(false);
    }
  };

  const handleLoginSuccess = (role) => {
    setUserRole(role);
    sessionStorage.setItem('posUserRole', role);
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
        className="w-full shadow-sm h-[60px] flex-shrink-0 relative z-[9999]"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-medium)',
        }}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="w-full max-w-[1920px] mx-auto flex items-center justify-between h-full">
          <div
            className="h-full flex items-center justify-center flex-shrink-0 px-4 md:px-0 w-auto md:w-[16.5rem]"
            style={{ borderRight: '1px solid var(--border-medium)' }}
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
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M9.9 9.9l4.242 4.242M6.364 13.435A9 9 0 0113.435 6.364m-4.242 4.243a3 3 0 004.242 4.242" />
                </svg>
                <span className="hidden md:inline">OFFLINE MODE</span>
              </div>
            )}
            <button
              onClick={() => setIsMobileScannerOpen(true)}
              className="md:hidden px-3 py-2 text-xs font-bold uppercase focus:outline-none whitespace-nowrap shrink-0 flex items-center justify-center"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
              }}
              aria-label="Open barcode scanner"
            >
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
              </svg>
            </button>

            {userRole === 'owner' ? (
              <>
                <button
                  onClick={() => navigate('/owner/dashboard')}
                  className="px-3 md:px-6 py-2 md:py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: location.pathname.startsWith('/owner') ? 'var(--color-accent)' : 'var(--bg-secondary)',
                    color: location.pathname.startsWith('/owner') ? '#ffffff' : 'var(--text-primary)',
                    border: `1px solid ${location.pathname.startsWith('/owner') ? 'var(--color-accent)' : 'var(--border-medium)'}`,
                  }}
                >
                  <span className="hidden md:inline">Management</span>
                  <svg className="w-[18px] h-[18px] md:hidden" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H6A2.25 2.25 0 003.75 6v2.25A2.25 2.25 0 006 10.5zm0 9.75h2.25A2.25 2.25 0 0010.5 18v-2.25a2.25 2.25 0 00-2.25-2.25H6a2.25 2.25 0 00-2.25 2.25V18A2.25 2.25 0 006 20.25zm9.75-9.75H18a2.25 2.25 0 002.25-2.25V6A2.25 2.25 0 0018 3.75h-2.25A2.25 2.25 0 0013.5 6v2.25a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </button>
                <button
                  onClick={() => navigate('/printer')}
                  className="px-3 md:px-6 py-2 md:py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-2"
                  style={{
                    backgroundColor: location.pathname.startsWith('/printer') ? 'var(--color-accent)' : 'var(--bg-secondary)',
                    color: location.pathname.startsWith('/printer') ? '#ffffff' : 'var(--text-primary)',
                    border: `1px solid ${location.pathname.startsWith('/printer') ? 'var(--color-accent)' : 'var(--border-medium)'}`,
                  }}
                >
                  <span className="hidden md:inline">Barcodes</span>
                  <svg className="w-[18px] h-[18px] md:hidden" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                </button>
              </>
            ) : (
              <button
                onClick={() => navigate('/terminal/dashboard')}
                className="px-3 md:px-6 py-2 md:py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-2"
                style={{
                  backgroundColor: location.pathname.startsWith('/terminal') ? 'var(--color-accent)' : 'var(--bg-secondary)',
                  color: location.pathname.startsWith('/terminal') ? '#ffffff' : 'var(--text-primary)',
                  border: `1px solid ${location.pathname.startsWith('/terminal') ? 'var(--color-accent)' : 'var(--border-medium)'}`,
                }}
              >
                <span className="hidden md:inline">Terminal</span>
                <svg className="w-[18px] h-[18px] md:hidden" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                </svg>
              </button>
            )}

            <div className="h-8 w-px mx-1" style={{ backgroundColor: 'var(--border-medium)' }} />

            {/* Dark Mode Toggle */}
            <button
              onClick={toggleDarkMode}
              className="px-3 py-2 transition-colors flex items-center justify-center focus:outline-none focus:ring-1 shrink-0"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
              }}
              title="Toggle Dark Mode"
              aria-label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDarkMode ? (
                <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-[18px] h-[18px]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-[18px] h-[18px]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </button>

            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="px-3 md:px-6 py-2 md:py-2.5 text-xs font-bold uppercase tracking-wider transition-colors focus:outline-none whitespace-nowrap shrink-0 flex items-center justify-center gap-2 border bg-[var(--color-error)] text-white border-[var(--color-error)] hover:bg-[#c90f1f] hover:border-[#c90f1f]"
            >
              <span className="hidden md:inline">Sign Out</span>
              <svg className="w-[18px] h-[18px] md:hidden" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main
        className="flex-1 w-full max-w-[1920px] mx-auto p-4 md:p-6 overflow-y-auto relative z-10"
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