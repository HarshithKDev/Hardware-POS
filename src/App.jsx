import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';

function App() {
  // Grab stored session data if it exists, otherwise default to null/login
  const [userRole, setUserRole] = useState(() => sessionStorage.getItem('posUserRole') || null); 
  const [currentScreen, setCurrentScreen] = useState(() => sessionStorage.getItem('posCurrentScreen') || 'login');
  const [inventory, setInventory] = useState([]); 
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  const [shopSettings, setShopSettings] = useState(null);
  const [isSetupNeeded, setIsSetupNeeded] = useState(false);

  useEffect(() => { 
    fetchInitialData(); 
  }, []);

  // Whenever userRole changes, save it to the browser's session storage
  useEffect(() => {
    if (userRole) sessionStorage.setItem('posUserRole', userRole);
    else sessionStorage.removeItem('posUserRole');
  }, [userRole]);

  // Whenever the screen changes, save it to the browser's session storage
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
      if (invData) setInventory(invData);
      
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
      if (data) setInventory(data);
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
    // Clear the memory explicitly on logout
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
        <div className="flex gap-1 items-center">
          <span className="bg-transparent px-3 py-1 text-sm font-semibold mr-4 capitalize">User: {userRole}</span>
          
          {userRole === 'owner' ? (
            <>
              <button onClick={() => setCurrentScreen('dashboard')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'dashboard' ? 'bg-[#0078D7] text-white' : 'bg-transparent hover:bg-[#333333]'}`}>Owner Dashboard</button>
              <button onClick={() => setCurrentScreen('printer')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'printer' ? 'bg-[#0078D7] text-white' : 'bg-transparent hover:bg-[#333333]'}`}>Print Barcodes</button>
            </>
          ) : (
            <button onClick={() => setCurrentScreen('billing')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'billing' ? 'bg-[#0078D7] text-white' : 'bg-transparent hover:bg-[#333333]'}`}>Worker Terminal</button>
          )}
        </div>
        <button onClick={handleLogout} className="px-4 py-2 bg-transparent hover:bg-[#e81123] text-white text-sm transition-colors rounded-none">Logout</button>
      </nav>

      <main className="p-4">
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} refreshInventory={fetchInventory} shopSettings={shopSettings} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>
    </div>
  );
}

export default App;