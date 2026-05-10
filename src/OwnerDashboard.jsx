import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import OwnerStats from './OwnerStats';
import OwnerCatalog from './OwnerCatalog';
import OwnerInventory from './OwnerInventory';
import OwnerLedger from './OwnerLedger';
import OwnerStaff from './OwnerStaff';
import WorkerBilling from './WorkerBilling';

export default function OwnerDashboard({ shopSettings, cashierName }) {
  const { tab } = useParams();
  const activeTab = tab || 'dashboard';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const warehouseSubTab = searchParams.get('sub') || 'inventory';
  const storeSubTab = searchParams.get('sub') || 'inventory';
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); 
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'System Alert' });
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, message: '', title: 'Action Required', onConfirm: null });

  const changeTab = (newTab) => { navigate(`/owner/${newTab}`); setIsSidebarOpen(false); };
  const showAlert = (message, title = 'System Alert') => setAlertConfig({ isOpen: true, message, title });
  const showConfirm = (message, onConfirmCallback, title = 'Action Required') => setConfirmConfig({ isOpen: true, message, title, onConfirm: onConfirmCallback });

  return (
    <div className="flex flex-col md:flex-row bg-white border border-gray-400 h-full shadow-none rounded-none" style={{ fontFamily: "'Roboto', sans-serif" }}>
      
      {/* Keeping identical Modals structure as requested */}
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] px-4">
          <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold uppercase tracking-wider text-black">{alertConfig.title}</span>
              <button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm font-medium text-black">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
              <button onClick={() => setAlertConfig({ ...alertConfig, isOpen: false })} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">OK</button>
            </div>
          </div>
        </div>
      )}

      {confirmConfig.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] px-4">
          <div className="bg-white border border-gray-400 w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold uppercase tracking-wider text-black">{confirmConfig.title}</span>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm font-medium text-black">{confirmConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => { if (confirmConfig.onConfirm) confirmConfig.onConfirm(); setConfirmConfig({ ...confirmConfig, isOpen: false }); }} className="px-6 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm border border-transparent focus:outline-none focus:ring-1 focus:ring-black rounded-none">Execute</button>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="px-6 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm focus:outline-none focus:border-[#0078D7] rounded-none">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="md:hidden flex justify-between items-center bg-[#f3f3f3] p-4 border-b border-gray-400">
        <span className="text-sm font-semibold uppercase text-gray-700 tracking-wider">Console Menu</span>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="border border-gray-400 bg-white px-4 py-1.5 text-sm focus:outline-none focus:border-[#0078D7] rounded-none">☰</button>
      </div>

      <aside className={`${isSidebarOpen ? 'block' : 'hidden'} md:block w-full md:w-[240px] bg-[#f3f3f3] border-b md:border-r border-gray-400 flex-shrink-0 pt-4`}>
        <div className="flex flex-col gap-1">
          <button onClick={() => changeTab('dashboard')} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'dashboard' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Dashboard</button>
          <button onClick={() => changeTab('register')} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'register' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Catalog</button>
          <button onClick={() => changeTab('warehouse')} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'warehouse' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Warehouse</button>
          <button onClick={() => changeTab('store')} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'store' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Store Floor</button>
          <button onClick={() => changeTab('sales')} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'sales' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Ledger</button>
          <button onClick={() => changeTab('staff')} className={`text-left px-6 py-2.5 text-sm transition-none focus:outline-none rounded-none ${activeTab === 'staff' ? 'bg-[#cce8ff] border-l-4 border-[#0078D7] text-black font-semibold' : 'border-l-4 border-transparent hover:bg-[#e6e6e6] text-gray-800'}`}>Security</button>
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-8 overflow-y-auto bg-white relative">
        {activeTab === 'dashboard' && <OwnerStats />}
        {activeTab === 'register' && <OwnerCatalog showAlert={showAlert} />}
        {activeTab === 'warehouse' && (
          <div className="flex flex-col h-full animate-fade-in">
            <h1 className="text-2xl font-light text-black mb-6">Warehouse Operations</h1>
            <div className="flex gap-1 mb-6 border-b border-gray-300 pb-0">
              <button onClick={()=>setSearchParams({ sub: 'inventory' })} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${warehouseSubTab==='inventory'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Master List</button>
              <button onClick={()=>setSearchParams({ sub: 'receive' })} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${warehouseSubTab==='receive'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Receive Stock</button>
              <button onClick={()=>setSearchParams({ sub: 'transfer' })} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${warehouseSubTab==='transfer'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Transfer Stock</button>
            </div>
            {warehouseSubTab === 'inventory' && <OwnerInventory viewType="warehouse" showAlert={showAlert} showConfirm={showConfirm} />}
            {warehouseSubTab === 'receive' && <div className="border border-gray-400 bg-white flex-1 mb-4 rounded-none"><WorkerBilling defaultTab="receive" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
            {warehouseSubTab === 'transfer' && <div className="border border-gray-400 bg-white flex-1 mb-4 rounded-none"><WorkerBilling defaultTab="transfer" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
          </div>
        )}
        {activeTab === 'store' && (
          <div className="flex flex-col h-full animate-fade-in">
            <h1 className="text-2xl font-light text-black mb-6">Retail Operations</h1>
            <div className="flex gap-1 mb-6 border-b border-gray-300 pb-0">
              <button onClick={()=>setSearchParams({ sub: 'inventory' })} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${storeSubTab==='inventory'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Floor List</button>
              <button onClick={()=>setSearchParams({ sub: 'checkout' })} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${storeSubTab==='checkout'?'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold':'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>POS Terminal</button>
            </div>
            {storeSubTab === 'inventory' && <OwnerInventory viewType="store" showAlert={showAlert} showConfirm={showConfirm} />}
            {storeSubTab === 'checkout' && <div className="border border-gray-400 bg-white flex-1 mb-4 rounded-none"><WorkerBilling defaultTab="checkout" hideNav={true} shopSettings={shopSettings} cashierName={cashierName} /></div>}
          </div>
        )}
        {activeTab === 'sales' && <OwnerLedger />}
        {activeTab === 'staff' && <OwnerStaff showAlert={showAlert} showConfirm={showConfirm} />}
      </main>
    </div>
  );
}