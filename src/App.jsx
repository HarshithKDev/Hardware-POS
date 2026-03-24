import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';
import { Html5QrcodeScanner } from "html5-qrcode";

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
  const [isMobileScannerOpen, setIsMobileScannerOpen] = useState(false);
  const [scannedProduct, setScannedProduct] = useState(null);

  useEffect(() => { fetchInitialData(); }, []);

  useEffect(() => {
    if (userRole) sessionStorage.setItem('posUserRole', userRole);
    else sessionStorage.removeItem('posUserRole');
  }, [userRole]);

  useEffect(() => { sessionStorage.setItem('posCurrentScreen', currentScreen); }, [currentScreen]);

  useEffect(() => {
    if (isMobileScannerOpen) {
      const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 }, rememberLastUsedCamera: true, aspectRatio: 1.0 });
      scanner.render((decodedText) => {
        const product = inventory.find(item => item.barcode === decodedText && item.is_active !== false);
        if (product) {
          setScannedProduct(product);
          try { scanner.clear(); } catch(e) {}
          setIsMobileScannerOpen(false);
        } else {
          alert("Product not found in active catalog.");
        }
      }, () => {});
      return () => { try { scanner.clear(); } catch(e) {} };
    }
  }, [isMobileScannerOpen, inventory]);

  const fetchInitialData = async () => {
    try {
      setIsInitialLoad(true);
      const { data: settingsData, error: settingsError } = await supabase.from('shop_settings').select('*').limit(1);
      if (settingsError && settingsError.code !== 'PGRST116') throw settingsError;
      
      if (!settingsData || settingsData.length === 0) setIsSetupNeeded(true);
      else setShopSettings(settingsData[0]);

      // DO NOT FILTER is_active HERE. WE NEED FULL HISTORY FOR BARCODE GENERATION
      const { data: invData } = await supabase.from('inventory').select('*').order('name', { ascending: true }); 
      if (invData) setInventory(invData);
    } catch (error) { console.error('System Load Error:', error.message); } 
    finally { setIsInitialLoad(false); }
  };

  const fetchInventory = async () => {
    try {
      // DO NOT FILTER is_active HERE. WE NEED FULL HISTORY FOR BARCODE GENERATION
      const { data } = await supabase.from('inventory').select('*').order('name', { ascending: true }); 
      if (data) setInventory(data);
    } catch (error) { console.error('Inventory Sync Error:', error.message); } 
  };

  const handleLoginSuccess = (role) => {
    setUserRole(role);
    if (role === 'owner') setCurrentScreen('dashboard');
    else setCurrentScreen('billing'); 
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
      <div className="w-full min-h-screen bg-[#f3f3f3] flex flex-col items-center justify-center text-black">
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'); * { font-family: 'Roboto', sans-serif !important; }`}</style>
        <Spinner className="w-8 h-8 text-[#0078D7] mb-4" />
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Initializing Subsystems</p>
      </div>
    );
  }

  if (isSetupNeeded || !userRole) {
    return (
      <div>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'); * { font-family: 'Roboto', sans-serif !important; }`}</style>
        <EntryFlow onLoginSuccess={handleLoginSuccess} isSetupNeeded={isSetupNeeded} onSetupComplete={(s) => {setShopSettings(s); setIsSetupNeeded(false);}} shopSettings={shopSettings} />
      </div>
    );
  }

  const displayUserName = userRole === 'owner' ? (shopSettings?.owner_name || 'Administrator') : 'Terminal User';

  return (
    <div className="w-full min-h-screen bg-[#e6e6e6] text-black relative">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap'); * { font-family: 'Roboto', sans-serif !important; }`}</style>

      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] px-4 print:hidden">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110] px-4 print:hidden">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120] px-4 print:hidden">
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

      <nav className="bg-white text-black border-b border-gray-300 px-4 py-2 flex justify-between items-center print:hidden shadow-sm">
        <div className="flex items-center">
          <div className="pr-4 mr-4 border-r border-gray-300">
            <span className="text-sm font-semibold text-black uppercase tracking-wider">{displayUserName}</span>
          </div>
          <div className="flex gap-1">
            <button onClick={() => setIsMobileScannerOpen(true)} className="md:hidden px-3 py-1.5 bg-transparent border border-gray-300 hover:bg-gray-100 text-xs text-black focus:outline-none focus:border-[#0078D7] rounded-none">Scan</button>
            {userRole === 'owner' ? (
              <>
                <button onClick={() => setCurrentScreen('dashboard')} className={`px-4 py-1.5 text-xs focus:outline-none rounded-none ${currentScreen === 'dashboard' ? 'bg-[#0078D7] text-white border border-[#0078D7]' : 'bg-transparent border border-transparent hover:bg-gray-100 text-black'}`}>Management</button>
                <button onClick={() => setCurrentScreen('printer')} className={`px-4 py-1.5 text-xs focus:outline-none rounded-none ${currentScreen === 'printer' ? 'bg-[#0078D7] text-white border border-[#0078D7]' : 'bg-transparent border border-transparent hover:bg-gray-100 text-black'}`}>Barcodes</button>
              </>
            ) : (
              <button onClick={() => setCurrentScreen('billing')} className={`px-4 py-1.5 text-xs focus:outline-none rounded-none ${currentScreen === 'billing' ? 'bg-[#0078D7] text-white border border-[#0078D7]' : 'bg-transparent border border-transparent hover:bg-gray-100 text-black'}`}>Terminal</button>
            )}
          </div>
        </div>
        <button onClick={() => setShowLogoutConfirm(true)} className="px-4 py-1.5 bg-transparent hover:bg-[#e81123] hover:text-white text-xs text-black border border-transparent transition-none rounded-none">Sign Out</button>
      </nav>

      <main className="p-4 md:p-6 max-w-[1920px] mx-auto h-[calc(100vh-50px)]">
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} cashierName={displayUserName} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} cashierName={displayUserName} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>
    </div>
  );
}

export default App;