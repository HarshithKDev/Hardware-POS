import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { Spinner } from './SharedUI';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';
import { LogoutModal, MobileScannerModal, ProductInfoModal } from './AppModals';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';

function App() {
  const [userRole, setUserRole] = useState(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [shopSettings, setShopSettings] = useState(null);
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);

  // --- DARK MODE ---
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('posDarkMode');
      if (saved !== null) return JSON.parse(saved);
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('posDarkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { fetchInitialData(); }, []);

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
        if (savedRole) setUserRole(savedRole);
      } else {
        sessionStorage.removeItem('posUserRole');
      }
    } catch (error) {
      console.error('System Load Error:', error.message);
    } finally {
      setIsInitialLoad(false);
    }
  };

  // Fixed: accepts role only — access_token is managed by supabase-js internally
  const handleLoginSuccess = (role) => {
    setUserRole(role);
    sessionStorage.setItem('posUserRole', role);
    if (role === 'owner') navigate('/owner/dashboard');
    else navigate('/terminal/dashboard');
  };

  const confirmLogout = async () => {
    await supabase.auth.signOut();
    setUserRole(null);
    sessionStorage.removeItem('posUserRole');
    setShowLogoutConfirm(false);
    navigate('/');
  };

  if (isInitialLoad) {
    return (
      <div className="w-full min-h-screen bg-[#f3f3f3] flex flex-col items-center justify-center text-black">
        <Spinner className="w-8 h-8 text-[#0078D7] mb-4" />
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Initializing Subsystems</p>
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

  const displayUserName = userRole === 'owner'
    ? (shopSettings?.owner_name || 'Administrator')
    : (userRole || 'Terminal User');

  return (
    <div className="w-full h-screen bg-[#e6e6e6] text-black flex flex-col overflow-hidden">

      {/* MODALS — rendered from AppModals, not inlined here */}
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
      <nav className="w-full bg-white border-b border-gray-300 shadow-sm h-[60px] flex items-center justify-between px-4 flex-shrink-0 relative z-[9999]">

        <div className="h-full flex items-center border-r border-gray-300 pr-4 w-[200px] flex-shrink-0">
          <span className="text-sm font-bold text-black uppercase tracking-wider truncate w-full block">
            {displayUserName}
          </span>
        </div>

        <div className="flex-1 flex items-center justify-end gap-3 h-full pl-4 overflow-x-auto">

          <button
            onClick={() => setIsMobileScannerOpen(true)}
            className="md:hidden px-4 py-2 bg-white border border-gray-400 hover:bg-[#e6e6e6] text-xs font-bold uppercase text-black focus:outline-none rounded-none"
          >
            Scan
          </button>

          {userRole === 'owner' ? (
            <>
              <button
                onClick={() => navigate('/owner/dashboard')}
                className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/owner') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-[#e6e6e6] text-black'}`}
              >
                Management
              </button>
              <button
                onClick={() => navigate('/printer')}
                className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/printer') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-[#e6e6e6] text-black'}`}
              >
                Barcodes
              </button>
            </>
          ) : (
            <button
              onClick={() => navigate('/terminal/dashboard')}
              className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/terminal') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-[#e6e6e6] text-black'}`}
            >
              Terminal
            </button>
          )}

          <div className="h-8 w-px bg-gray-300 mx-1" />

          {/* Dark Mode Toggle */}
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="px-3 py-2 bg-white hover:bg-[#e6e6e6] text-black border border-gray-400 transition-colors rounded-none flex items-center justify-center focus:outline-none"
            title="Toggle Dark Mode"
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
            className="px-6 py-2.5 bg-white hover:bg-[#e81123] hover:text-white hover:border-[#e81123] text-xs font-bold uppercase tracking-wider text-black border border-gray-400 transition-colors rounded-none"
          >
            Sign Out
          </button>

        </div>
      </nav>

      {/* MAIN CONTENT */}
      <main className="flex-1 w-full max-w-[1920px] mx-auto p-4 md:p-6 overflow-y-auto relative z-10">
        <Routes>
          {userRole === 'owner' && (
            <>
              <Route path="/owner/:tab" element={<OwnerDashboard shopSettings={shopSettings} cashierName={displayUserName} />} />
              <Route path="/owner" element={<Navigate to="/owner/dashboard" replace />} />
              <Route path="/printer" element={<BarcodePrinter />} />
            </>
          )}
          {userRole && (
            <>
              <Route path="/terminal/:tab" element={<WorkerBilling shopSettings={shopSettings} cashierName={displayUserName} />} />
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