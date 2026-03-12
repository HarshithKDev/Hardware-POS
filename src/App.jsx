import React, { useState } from 'react';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter';

const MASTER_INVENTORY = [
  { barcode: '1001', name: 'Brass Door Handle', price: 450, stock: 45 },
  { barcode: '1002', name: 'Steel Soap Stand', price: 120, stock: 12 },
  { barcode: '1003', name: 'Ceramic Mug', price: 150, stock: 30 },
  { barcode: '1004', name: 'Screws (Pack of 50)', price: 50, stock: 200 },
];

function App() {
  const [userRole, setUserRole] = useState(null); 
  const [sessionLocation, setSessionLocation] = useState(null); 
  
  const [currentScreen, setCurrentScreen] = useState('login');
  const [inventory, setInventory] = useState(MASTER_INVENTORY); 

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

  return (
    // Classic Windows light gray background
    <div className="w-full min-h-screen bg-[#f3f3f3] text-black">
      
      {/* Windows-style Dark Taskbar */}
      <nav className="bg-[#1e1e1e] text-white p-2 flex justify-between items-center print:hidden border-b-2 border-[#0078D7]">
        <div className="flex gap-1 items-center">
          <span className="bg-transparent px-3 py-1 text-sm font-semibold mr-4">
            {sessionLocation}
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
        {currentScreen === 'billing' && <WorkerBilling inventory={inventory} />}
        {currentScreen === 'dashboard' && userRole === 'owner' && <OwnerDashboard inventory={inventory} setInventory={setInventory} />}
        {currentScreen === 'printer' && userRole === 'owner' && <BarcodePrinter inventory={inventory} />}
      </main>

    </div>
  );
}

export default App;