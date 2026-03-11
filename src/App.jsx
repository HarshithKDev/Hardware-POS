import React, { useState } from 'react';
import EntryFlow from './EntryFlow';
import WorkerBilling from './WorkerBilling';
import OwnerDashboard from './OwnerDashboard';
import BarcodePrinter from './BarcodePrinter'; // Imported the new component

function App() {
  const [currentScreen, setCurrentScreen] = useState('login');

  return (
    <div className="w-full min-h-screen bg-gray-50">
      
      <nav className="bg-slate-900 text-white p-4 flex gap-4 justify-center shadow-md print:hidden">
        <button 
          onClick={() => setCurrentScreen('login')}
          className={`px-4 py-2 rounded transition-colors ${currentScreen === 'login' ? 'bg-blue-600' : 'bg-slate-700 hover:bg-slate-600'}`}
        >
          Login
        </button>
        <button 
          onClick={() => setCurrentScreen('billing')}
          className={`px-4 py-2 rounded transition-colors ${currentScreen === 'billing' ? 'bg-emerald-600' : 'bg-slate-700 hover:bg-slate-600'}`}
        >
          Worker POS
        </button>
        <button 
          onClick={() => setCurrentScreen('dashboard')}
          className={`px-4 py-2 rounded transition-colors ${currentScreen === 'dashboard' ? 'bg-blue-600' : 'bg-slate-700 hover:bg-slate-600'}`}
        >
          Dashboard
        </button>
        <button 
          onClick={() => setCurrentScreen('printer')}
          className={`px-4 py-2 rounded transition-colors ${currentScreen === 'printer' ? 'bg-blue-600' : 'bg-slate-700 hover:bg-slate-600'}`}
        >
          Print Barcodes
        </button>
      </nav>

      <main>
        {currentScreen === 'login' && <EntryFlow />}
        {currentScreen === 'billing' && <WorkerBilling />}
        {currentScreen === 'dashboard' && <OwnerDashboard />}
        {currentScreen === 'printer' && <BarcodePrinter />}
      </main>

    </div>
  );
}

export default App;