import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';

function App() {
  const [userRole, setUserRole] = useState(null); 
  const [sessionLocation, setSessionLocation] = useState(null); 
  const [currentScreen, setCurrentScreen] = useState('login');
  
  // Cloud Database States
  const [inventory, setInventory] = useState([]); 
  
  // We renamed this to isInitialLoad so it ONLY triggers when the app first opens
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Fetch the live data from Supabase when the app starts
  useEffect(() => {
    // We pass "true" here to tell the function this is the first load
    fetchInventory(true);
  }, []);

  // Now the function accepts an argument. It defaults to false for background refreshes.
  const fetchInventory = async (initial = false) => {
    try {
      if (initial) setIsInitialLoad(true);
      
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .order('name', { ascending: true }); 
      
      if (error) throw error;
      
      if (data) {
        setInventory(data);
      }
    } catch (error) {
      console.error('Error fetching inventory:', error.message);
      alert('Failed to connect to the cloud database!');
    } finally {
      // Only turn off the loading screen if we were the ones who turned it on
      if (initial) setIsInitialLoad(false);
    }
  };

  const handleLoginSuccess = (role, loc) => {
    setUserRole(role);
    setSessionLocation(loc);
    if (role === 'owner') {
      setCurrentScreen('dashboard');
    } else {
      setCurrentScreen('billing');
    }
  };

  const handleLogout = () => {
    setUserRole(null);
    setSessionLocation(null);
    setCurrentScreen('login');
  };

  if (!userRole) {
    return <EntryFlow onLoginSuccess={handleLoginSuccess} />;
  }

  // This loading screen will now ONLY show up once when the user first logs in
  if (isInitialLoad) {
    return (
      <div className="w-full min-h-screen bg-[#f3f3f3] flex items-center justify-center text-black">
        <p className="text-xl font-light">Loading Database...</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-[#f3f3f3] text-black">
      
      <nav className="bg-[#1e1e1e] text-white p-2 flex justify-between items-center print:hidden border-b-2 border-[#0078D7]">
        <div className="flex gap-1 items-center">
          <span className="bg-transparent px-3 py-1 text-sm font-semibold mr-4">
            📍 {sessionLocation}
          </span>

          <button onClick={() => setCurrentScreen('billing')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'billing' ? 'bg-[#0078D7] text-white' : 'bg-transparent hover:bg-[#333333]'}`}>
            Worker POS
          </button>
          
          {userRole === 'owner' && (
            <>
              <button onClick={() => setCurrentScreen('dashboard')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'dashboard' ? 'bg-[#0078D7] text-white' : 'bg-transparent hover:bg-[#333333]'}`}>
                Owner Dashboard
              </button>
              <button onClick={() => setCurrentScreen('printer')} className={`px-4 py-2 text-sm transition-colors rounded-none ${currentScreen === 'printer' ? 'bg-[#0078D7] text-white' : 'bg-transparent hover:bg-[#333333]'}`}>
                Print Barcodes
              </button>
            </>
          )}
        </div>

        <button onClick={handleLogout} className="px-4 py-2 bg-transparent hover:bg-[#e81123] text-white text-sm transition-colors rounded-none">
          Logout
        </button>
      </nav>

      <main className="p-4">
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} refreshInventory={fetchInventory} sessionLocation={sessionLocation} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} refreshInventory={fetchInventory} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>

    </div>
  );
}

export default App;