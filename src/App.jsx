import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';

function App() {
  const [userRole, setUserRole] = useState(() => sessionStorage.getItem('posUserRole') || null); 
  const [currentScreen, setCurrentScreen] = useState(() => sessionStorage.getItem('posCurrentScreen') || 'login');
  const [inventory, setInventory] = useState([]); 
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  const [shopSettings, setShopSettings] = useState(null);
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);

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

  const handleLogout = () => {
    setUserRole(null);
    setCurrentScreen('login');
    sessionStorage.removeItem('posUserRole');
    sessionStorage.removeItem('posCurrentScreen');
  };

  if (isInitialLoad) {
    return <div className="w-full min-h-screen bg-[#f3f3f3] flex items-center justify-center text-black"><p className="text-xl font-light">Loading Database...</p></div>;
  }

  if (isSetupNeeded || !userRole) {
    return <EntryFlow 
      onLoginSuccess={handleLoginSuccess} 
      isSetupNeeded={isSetupNeeded} 
      onSetupComplete={handleSetupComplete} 
      shopSettings={shopSettings} 
    />;
  }

  return (
    <div className="w-full min-h-screen bg-[#f3f3f3] text-black">
      <nav className="bg-[#1e1e1e] text-white p-2 flex justify-between items-center print:hidden border-b-2 border-[#0078D7]">
        <div className="flex items-center">
          
          {/* CLEAN USER IDENTIFIER (No weird blocks, just an icon and the name) */}
          <div className="flex items-center gap-2 pr-6 mr-4 border-r border-gray-600">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-[#0078D7]">
              <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z" clipRule="evenodd" />
            </svg>
            <span className="text-lg font-light text-white capitalize tracking-wide">{userRole}</span>
          </div>
          
          {/* NAVIGATION BUTTONS */}
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
        <button onClick={handleLogout} className="px-4 py-2 bg-transparent hover:bg-[#e81123] text-white text-sm transition-colors rounded-none">Logout</button>
      </nav>

      <main className="p-0 md:p-4">
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} cashierName={userRole} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} cashierName={userRole} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>
    </div>
  );
}

export default App;