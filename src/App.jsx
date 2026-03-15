import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';

function App() {
  const [userRole, setUserRole] = useState(null); 
  const [currentScreen, setCurrentScreen] = useState('login');
  const [inventory, setInventory] = useState([]); 
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => { fetchInventory(true); }, []);

  const fetchInventory = async (initial = false) => {
    try {
      if (initial) setIsInitialLoad(true);
      const { data, error } = await supabase.from('inventory').select('*').order('name', { ascending: true }); 
      if (error) throw error;
      if (data) setInventory(data);
    } catch (error) { console.error('Error fetching inventory:', error.message); } 
    finally { if (initial) setIsInitialLoad(false); }
  };

  const handleLoginSuccess = (role) => {
    setUserRole(role);
    if (role === 'owner') setCurrentScreen('dashboard');
    else setCurrentScreen('billing'); // Workers go straight to POS
  };

  const handleLogout = () => {
    setUserRole(null);
    setCurrentScreen('login');
  };

  if (!userRole) return <EntryFlow onLoginSuccess={handleLoginSuccess} />;

  if (isInitialLoad) {
    return <div className="w-full min-h-screen bg-[#f3f3f3] flex items-center justify-center text-black"><p className="text-xl font-light">Loading Database...</p></div>;
  }

  return (
    <div className="w-full min-h-screen bg-[#f3f3f3] text-black">
      <nav className="bg-[#1e1e1e] text-white p-2 flex justify-between items-center print:hidden border-b-2 border-[#0078D7]">
        <div className="flex gap-1 items-center">
          
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
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} refreshInventory={fetchInventory} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} refreshInventory={fetchInventory} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>
    </div>
  );
}

export default App;