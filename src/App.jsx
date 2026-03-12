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
  const [loading, setLoading] = useState(true);

  // Fetch the live data from Supabase when the app starts
  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      // Query the 'inventory' table from our database
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
      setLoading(false);
    }
  };

  const handleLoginSuccess = (role, loc) => {
    setUserRole(role);
    setSessionLocation(loc);
    // Route them automatically based on their role
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

  // GATEKEEPER: If no user role exists, ONLY show the login screen
  if (!userRole) {
    return <EntryFlow onLoginSuccess={handleLoginSuccess} />;
  }

  // Show a Windows-style loading screen while fetching data
  if (loading) {
    return (
      <div className="w-full min-h-screen bg-[#f3f3f3] flex items-center justify-center text-black">
        <p className="text-xl font-light">Loading Database...</p>
      </div>
    );
  }

  return (
    // Classic Windows light gray background
    <div className="w-full min-h-screen bg-[#f3f3f3] text-black">
      
      {/* Windows-style Dark Taskbar */}
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

        {/* The classic red close/logout button hover effect */}
        <button onClick={handleLogout} className="px-4 py-2 bg-transparent hover:bg-[#e81123] text-white text-sm transition-colors rounded-none">
          Logout
        </button>
      </nav>

      <main className="p-4">
        {/* We pass inventory, refreshInventory, and sessionLocation down to the child screens */}
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} refreshInventory={fetchInventory} sessionLocation={sessionLocation} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} refreshInventory={fetchInventory} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>

    </div>
  );
}

export default App;