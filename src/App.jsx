import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';
// Library for mobile scanning
import { Html5QrcodeScanner } from "html5-qrcode";

// Reusable animated spinner
export const Spinner = ({ className = "w-5 h-5 text-current" }) => (
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

function App() {
  const [userRole, setUserRole] = useState(() => sessionStorage.getItem('posUserRole') || null); 
  const [currentScreen, setCurrentScreen] = useState(() => sessionStorage.getItem('posCurrentScreen') || 'login');
  const [inventory, setInventory] = useState([]); 
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [shopSettings, setShopSettings] = useState(null);
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Mobile Scanner States
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);

  useEffect(() => { 
    fetchInitialData(); 
  }, []);

  useEffect(() => {
    if (userRole) sessionStorage.setItem('posUserRole', userRole);
    else sessionStorage.removeItem('posUserRole');
  }, [userRole]);

  useEffect(() => {
    sessionStorage.setItem('posCurrentScreen', currentScreen);
  }, [currentScreen]);

  // Mobile Scanner Logic
  useEffect(() => {
    if (isMobileScannerOpen) {
      const scanner = new Html5QrcodeScanner("reader", { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        rememberLastUsedCamera: true,
        aspectRatio: 1.0
      });

      scanner.render((decodedText) => {
        const product = inventory.find(item => item.barcode === decodedText);
        if (product) {
          setScannedProduct(product);
          scanner.clear();
          setIsMobileScannerOpen(false);
        } else {
          alert("Product not found in inventory.");
        }
      }, (error) => { /* Background scanning */ });

      return () => scanner.clear();
    }
  }, [isMobileScannerOpen, inventory]);

  const fetchInitialData = async () => {
    try {
      setIsInitialLoad(true);
      const { data: settingsData, error: settingsError } = await supabase.from('shop_settings').select('*').limit(1);
      if (settingsError && settingsError.code !== 'PGRST116') throw settingsError;
      if (!settingsData || settingsData.length === 0) setIsSetupNeeded(true);
      else setShopSettings(settingsData[0]);

      const { data: invData, error: invError } = await supabase.from('inventory').select('*').order('name', { ascending: true }); 
      if (invError) throw invError;
      if (invData) setInventory(invData.filter(item => item.is_active !== false));
    } catch (error) { console.error('Error:', error.message); } 
    finally { setIsInitialLoad(false); }
  };

  const fetchInventory = async () => {
    const { data } = await supabase.from('inventory').select('*').order('name', { ascending: true }); 
    if (data) setInventory(data.filter(item => item.is_active !== false));
  };

  const handleLoginSuccess = (role) => {
    setUserRole(role);
    setCurrentScreen(role === 'owner' ? 'dashboard' : 'billing');
  };

  const confirmLogout = () => {
    setUserRole(null);
    setCurrentScreen('login');
    sessionStorage.removeItem('posUserRole');
    sessionStorage.removeItem('posCurrentScreen');
    setShowLogoutConfirm(false);
  };

  if (isInitialLoad) {
    return (
      <div className="w-full min-h-screen bg-[#f3f3f3] flex flex-col items-center justify-center">
        <Spinner className="w-12 h-12 text-[#0078D7] mb-4" />
        <p className="text-xl font-light text-gray-500">Connecting...</p>
      </div>
    );
  }

  if (isSetupNeeded || !userRole) {
    return <EntryFlow onLoginSuccess={handleLoginSuccess} isSetupNeeded={isSetupNeeded} onSetupComplete={(s) => {setShopSettings(s); setIsSetupNeeded(false);}} shopSettings={shopSettings} />;
  }

  const displayUserName = userRole === 'owner' ? (shopSettings?.owner_name || 'Owner') : userRole;

  return (
    <div className="w-full min-h-screen bg-[#f3f3f3] text-black font-sans">
      
      {/* LOGOUT MODAL */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100] px-4 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-sm overflow-hidden border border-gray-200">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-2">Sign out?</h3>
              <p className="text-sm text-gray-600">You will need to sign back in to access the terminal.</p>
            </div>
            <div className="bg-[#f9f9f9] p-4 flex justify-end gap-2">
              <button onClick={() => setShowLogoutConfirm(false)} className="px-5 py-2 text-sm font-medium hover:bg-gray-200 rounded-md transition-colors">Cancel</button>
              <button onClick={confirmLogout} className="px-5 py-2 text-sm font-medium bg-[#e81123] text-white hover:bg-[#b00d1a] rounded-md transition-colors">Sign out</button>
            </div>
          </div>
        </div>
      )}

      {/* SCANNER MODAL (X BUTTON REMOVED) */}
      {isMobileScannerOpen && (
        <div className="fixed inset-0 bg-white md:bg-black/60 z-[110] flex items-center justify-center backdrop-blur-md">
          <div className="bg-white w-full h-full md:h-auto md:max-w-md md:rounded-xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-4 flex items-center border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#0078D7] rounded-md flex items-center justify-center text-white">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm2 2V5h1v1H5zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zm2 2v-1h1v1H5zM13 3a1 1 0 00-1 1v3a1 1 0 001 1h3a1 1 0 001-1V4a1 1 0 00-1-1h-3zm1 2v1h1V5h-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <h3 className="font-semibold text-gray-800">Scan Product</h3>
              </div>
            </div>
            <div className="flex-1 p-6 flex flex-col items-center justify-center bg-gray-50">
              <div id="reader" className="w-full bg-white rounded-lg overflow-hidden border border-gray-200"></div>
            </div>
            <div className="p-4 bg-white border-t border-gray-100">
              <button onClick={() => setIsMobileScannerOpen(false)} className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-lg">CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* STOCK INFO POP-UP */}
      {scannedProduct && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] px-4 backdrop-blur-sm">
          <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden border border-gray-200">
            <div className="bg-[#0078D7] text-white p-5 flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2">Inventory Details</h3>
              <button onClick={() => setScannedProduct(null)} className="hover:bg-white/20 p-1 rounded-md">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l18 18" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <p className="text-gray-400 text-[10px] uppercase font-bold mb-1">Product</p>
              <p className="text-xl font-semibold text-gray-900 mb-6">{scannedProduct.name}</p>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                  <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Warehouse</p>
                  <p className="text-3xl font-bold text-gray-800">{scannedProduct.stock_warehouse || 0}</p>
                </div>
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                  <p className="text-[10px] text-[#0078D7] uppercase font-bold mb-1">Store</p>
                  <p className="text-3xl font-bold text-[#0078D7]">{scannedProduct.stock_store || 0}</p>
                </div>
              </div>
            </div>
            <button onClick={() => setScannedProduct(null)} className="w-full py-4 bg-gray-50 hover:bg-gray-100 text-gray-600 font-semibold border-t border-gray-100">DONE</button>
          </div>
        </div>
      )}

      {/* NAVIGATION BAR */}
      <nav className="bg-[#1e1e1e] text-white p-2 flex justify-between items-center print:hidden border-b-2 border-[#0078D7] sticky top-0 z-[50]">
        <div className="flex items-center flex-1">
          <div className="flex items-center gap-2 pr-4 mr-2 border-r border-gray-600 shrink-0">
            <span className="text-sm font-semibold text-[#0078D7] uppercase tracking-tighter">{displayUserName}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setIsMobileScannerOpen(true)} className="md:hidden px-3 py-1.5 bg-[#107c10] hover:bg-[#0e6d0e] text-white text-[10px] font-bold rounded flex items-center gap-1 transition-colors">
              SCAN
            </button>
            {userRole === 'owner' ? (
              <>
                <button onClick={() => setCurrentScreen('dashboard')} className={`px-3 py-1.5 text-[10px] uppercase font-bold transition-colors ${currentScreen === 'dashboard' ? 'bg-[#0078D7] text-white rounded' : 'text-gray-400 hover:text-white'}`}>Dashboard</button>
                <button onClick={() => setCurrentScreen('printer')} className={`px-3 py-1.5 text-[10px] uppercase font-bold transition-colors ${currentScreen === 'printer' ? 'bg-[#0078D7] text-white rounded' : 'text-gray-400 hover:text-white'}`}>Barcodes</button>
              </>
            ) : (
              <button onClick={() => setCurrentScreen('billing')} className={`px-3 py-1.5 text-[10px] uppercase font-bold transition-colors ${currentScreen === 'billing' ? 'bg-[#0078D7] text-white rounded' : 'text-gray-400 hover:text-white'}`}>Billing</button>
            )}
          </div>
        </div>
        <button onClick={() => setShowLogoutConfirm(true)} className="ml-2 px-3 py-1.5 hover:bg-[#e81123] text-[10px] uppercase font-bold text-white rounded transition-colors shrink-0">Logout</button>
      </nav>

      <main className="p-0 md:p-6 lg:p-10 max-w-[1920px] mx-auto">
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} cashierName={displayUserName} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} cashierName={displayUserName} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>
    </div>
  );
}

export default App;