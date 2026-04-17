import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';
import { Html5QrcodeScanner } from "html5-qrcode";
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';

export const Spinner = ({ className = "w-5 h-5 text-current" }) => (
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

function App() {
  const [userRole, setUserRole] = useState(null); 
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [shopSettings, setShopSettings] = useState(null);
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { fetchInitialData(); }, []);

  useEffect(() => {
    let scanner = null;
    let isVerifying = false;
    
    if (isMobileScannerOpen) {
      scanner = new Html5QrcodeScanner("reader", { 
        fps: 10, 
        qrbox: { width: 250, height: 250 }, 
        rememberLastUsedCamera: true, 
        aspectRatio: 1.0 
      });
      
      scanner.render(async (decodedText) => {
        if (isVerifying) return;
        isVerifying = true;
        
        const { data } = await supabase.from('inventory').select('*').eq('barcode', decodedText).eq('is_active', true).single();
        
        if (data) {
          setScannedProduct(data);
          if (scanner) {
            scanner.clear().catch(err => console.error("Scanner clear failed", err));
          }
          setIsMobileScannerOpen(false);
        } else {
          alert("Product not found in active catalog.");
          isVerifying = false;
        }
      }, () => {});
    }

    return () => { 
      if (scanner) { scanner.clear().catch(err => console.error("Scanner cleanup failed", err)); } 
    };
  }, [isMobileScannerOpen]);

  const fetchInitialData = async () => {
    try {
      setIsInitialLoad(true);
      const { data: settingsData, error: settingsError } = await supabase.from('shop_settings').select('*').limit(1);
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

    } catch (error) { console.error('System Load Error:', error.message); } 
    finally { setIsInitialLoad(false); }
  };

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
        <style>{`
          #root { padding: 0 !important; max-width: none !important; margin: 0 !important; text-align: left !important; width: 100% !important; height: 100% !important; }
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'); 
          * { font-family: 'Roboto', sans-serif !important; }
        `}</style>
        <Spinner className="w-8 h-8 text-[#0078D7] mb-4" />
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Initializing Subsystems</p>
      </div>
    );
  }

  if (isSetupNeeded || !userRole) {
    return (
      <div>
        <style>{`
          #root { padding: 0 !important; max-width: none !important; margin: 0 !important; text-align: left !important; width: 100% !important; height: 100% !important; }
          @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'); 
          * { font-family: 'Roboto', sans-serif !important; }
        `}</style>
        <EntryFlow onLoginSuccess={handleLoginSuccess} isSetupNeeded={isSetupNeeded} onSetupComplete={(s) => {setShopSettings(s); setIsSetupNeeded(false);}} shopSettings={shopSettings} />
      </div>
    );
  }

  const displayUserName = userRole === 'owner' ? (shopSettings?.owner_name || 'Administrator') : (userRole || 'Terminal User');

  return (
    <div className="w-full h-screen bg-[#e6e6e6] text-black flex flex-col overflow-hidden">
      <style>{`
        #root { padding: 0 !important; max-width: none !important; margin: 0 !important; text-align: left !important; width: 100% !important; height: 100% !important; }
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'); 
        * { font-family: 'Roboto', sans-serif !important; }
      `}</style>

      {/* MODALS */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500] px-4 print:hidden">
          <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold text-black">Sign Out</span>
              <button onClick={() => setShowLogoutConfirm(false)} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white">
              <p className="text-sm text-black">You will be logged out of the current session. Any unsaved data will be lost. Continue?</p>
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={confirmLogout} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">Sign Out</button>
              <button onClick={() => setShowLogoutConfirm(false)} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7] rounded-none">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {isMobileScannerOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500] px-4 print:hidden">
          <div className="bg-white w-full max-w-[450px] border border-gray-400 shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold text-black">Mobile Scanner</span>
              <button onClick={() => setIsMobileScannerOpen(false)} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 flex flex-col items-center bg-white">
              <div id="reader" className="w-full bg-white border border-gray-300 rounded-none"></div>
              <p className="mt-4 text-xs text-gray-500">Position the barcode within the frame.</p>
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
              <button onClick={() => setIsMobileScannerOpen(false)} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm w-full md:w-auto focus:outline-none focus:border-[#0078D7] rounded-none">Close</button>
            </div>
          </div>
        </div>
      )}

      {scannedProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[500] px-4 print:hidden">
          <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold text-black">Product Information</span>
              <button onClick={() => setScannedProduct(null)} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white">
              <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Nomenclature</p>
              <p className="text-xl font-light text-black mb-6">{scannedProduct.name}</p>
              <div className="flex gap-4">
                <div className="flex-1 bg-[#f3f3f3] p-4 border border-gray-300 text-center rounded-none">
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Warehouse</p>
                  <p className="text-3xl font-light text-black">{scannedProduct.stock_warehouse || 0}</p>
                </div>
                <div className="flex-1 bg-white p-4 border-2 border-[#0078D7] text-center rounded-none">
                  <p className="text-xs font-semibold text-[#0078D7] uppercase mb-1">Store Floor</p>
                  <p className="text-3xl font-light text-[#0078D7]">{scannedProduct.stock_store || 0}</p>
                </div>
              </div>
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
              <button onClick={() => setScannedProduct(null)} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">OK</button>
            </div>
          </div>
        </div>
      )}

      {/* REBUILT NAVBAR: Split into Left and Right sections to guarantee zero overlap */}
      <nav className="w-full bg-white border-b border-gray-300 shadow-sm h-[60px] flex items-center justify-between px-4 flex-shrink-0 relative z-[9999]">
        
        {/* LEFT ALIGNED: Username Box */}
        <div className="h-full flex items-center border-r border-gray-300 pr-4 w-[200px] flex-shrink-0">
          <span className="text-sm font-bold text-black uppercase tracking-wider truncate w-full block">
            {displayUserName}
          </span>
        </div>

        {/* RIGHT ALIGNED: Action Buttons */}
        <div className="flex-1 flex items-center justify-end gap-3 h-full pl-4 overflow-x-auto">
          
          <button 
            onClick={() => setIsMobileScannerOpen(true)} 
            className="md:hidden px-4 py-2 bg-white border border-gray-400 hover:bg-gray-200 text-xs font-bold uppercase text-black focus:outline-none rounded-none"
          >
            Scan
          </button>

          {userRole === 'owner' ? (
            <>
              <button 
                onClick={() => navigate('/owner/dashboard')} 
                className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/owner') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-gray-200 text-black'}`}
              >
                Management
              </button>

              <button 
                onClick={() => navigate('/printer')} 
                className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/printer') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-gray-200 text-black'}`}
              >
                Barcodes
              </button>
            </>
          ) : (
            <button 
              onClick={() => navigate('/terminal/dashboard')} 
              className={`px-6 py-2.5 text-xs font-bold uppercase tracking-wider focus:outline-none rounded-none transition-colors border ${location.pathname.startsWith('/terminal') ? 'bg-[#0078D7] text-white border-[#0078D7]' : 'bg-white border-gray-400 hover:bg-gray-200 text-black'}`}
            >
              Terminal
            </button>
          )}

          {/* Vertical Divider Line */}
          <div className="h-8 w-px bg-gray-300 mx-1"></div>

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