import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';

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

  // NEW: State for the custom logout modal
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

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

      const { data: invData, error: invError } = await supabase.from('inventory').select('*').order('name', { ascending: true }); 
      if (invError) throw invError;
      if (invData) setInventory(invData.filter(item => item.is_active !== false));
      
    } catch (error) { 
      console.error('Error fetching data:', error.message); 
    } finally { 
      setIsInitialLoad(false); 
    }
  };

  const fetchInventory = async () => {
    try {
      const { data, error } = await supabase.from('inventory').select('*').order('name', { ascending: true }); 
      if (error) throw error;
      if (data) setInventory(data.filter(item => item.is_active !== false));
    } catch (error) { console.error('Error fetching inventory:', error.message); } 
  };

  const handleLoginSuccess = (role) => {
    setUserRole(role);
    if (role === 'owner') setCurrentScreen('dashboard');
    else setCurrentScreen('billing'); 
  };

  const handleSetupComplete = (newSettings) => {
    setShopSettings(newSettings);
    setIsSetupNeeded(false);
  };

  // FIX: Open the custom modal instead of the ugly browser alert
  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
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
        <Spinner className="w-12 h-12 text-[#0078D7] mb-4" />
        <p className="text-xl font-light text-gray-500">Connecting to Database...</p>
      </div>
    );
  }

  if (isSetupNeeded || !userRole) {
    return <EntryFlow 
      onLoginSuccess={handleLoginSuccess} 
      isSetupNeeded={isSetupNeeded} 
      onSetupComplete={handleSetupComplete} 
      shopSettings={shopSettings} 
    />;
  }

  const displayUserName = userRole === 'owner' ? (shopSettings?.owner_name || 'Owner') : userRole;

  return (
    <div className="w-full min-h-screen bg-[#f3f3f3] text-black relative">
      
      {/* CUSTOM LOGOUT MODAL */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in print:hidden px-4">
          <div className="bg-white border border-gray-400 w-full max-w-sm shadow-[4px_4px_0px_rgba(0,0,0,0.15)] rounded-none">
            <div className="bg-[#f3f3f3] p-2 border-b border-gray-400 flex justify-between items-center">
              <span className="text-sm font-semibold text-black px-1">Confirm Logout</span>
              <button onClick={() => setShowLogoutConfirm(false)} className="text-gray-500 hover:text-[#e81123] text-lg leading-none px-2 transition-colors">×</button>
            </div>
            <div className="p-6">
              <p className="text-sm text-black">Are you sure you want to log out? Any unscanned items in the current cart will be lost.</p>
            </div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-400 flex justify-end gap-3">
              <button onClick={confirmLogout} className="px-6 py-1.5 bg-[#e81123] hover:bg-[#b00d1a] transition-colors text-white text-sm rounded-none">Log Out</button>
              <button onClick={() => setShowLogoutConfirm(false)} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] transition-colors text-black border border-gray-400 text-sm rounded-none">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <nav className="bg-[#1e1e1e] text-white p-2 flex justify-between items-center print:hidden border-b-2 border-[#0078D7]">
        <div className="flex items-center">
          
          <div className="flex items-center gap-2 pr-6 mr-4 border-r border-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-[#0078D7]">
              <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
            </svg>
            <span className="text-lg font-light text-white capitalize tracking-wide">{displayUserName}</span>
          </div>
          
          <div className="flex gap-1">
            {userRole === 'owner' ? (
              <>
                <button onClick={() => setCurrentScreen('dashboard')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'dashboard' ? 'bg-[#0078D7] text-white' : 'bg-transparent text-gray-300 hover:bg-[#333333] hover:text-white'}`}>Owner Dashboard</button>
                <button onClick={() => setCurrentScreen('printer')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'printer' ? 'bg-[#0078D7] text-white' : 'bg-transparent text-gray-300 hover:bg-[#333333] hover:text-white'}`}>Print Barcodes</button>
              </>
            ) : (
              <button onClick={() => setCurrentScreen('billing')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'billing' ? 'bg-[#0078D7] text-white' : 'bg-transparent text-gray-300 hover:bg-[#333333] hover:text-white'}`}>Worker Terminal</button>
            )}
          </div>

        </div>
        <button onClick={handleLogoutClick} className="px-4 py-2 bg-transparent hover:bg-[#e81123] text-white text-sm transition-colors rounded-none">Logout</button>
      </nav>

      <main className="p-0 md:p-4">
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} cashierName={displayUserName} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} cashierName={displayUserName} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>
    </div>
  );
}

export default App;