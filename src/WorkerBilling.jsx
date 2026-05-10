import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import WorkerDashboardView from './WorkerDashboardView';
import WorkerTerminal from './WorkerTerminal';

export default function WorkerBilling({ defaultTab = 'dashboard', hideNav = false, shopSettings, cashierName, refreshInventory }) {
  const { tab } = useParams();
  const activeTab = hideNav ? defaultTab : (tab || 'dashboard');
  const navigate = useNavigate();
  
  const [alertConfig, setAlertConfig] = useState({ isOpen: false, message: '', title: 'System Notice' });
  const [confirmConfig, setConfirmConfig] = useState({ isOpen: false, message: '', title: 'Action Required', onConfirm: null });

  const showAlert = (message, title = 'System Notice') => setAlertConfig({ isOpen: true, message, title });
  const closeAlert = () => setAlertConfig({ ...alertConfig, isOpen: false });
  const showConfirm = (message, onConfirmCallback, title = 'Action Required') => setConfirmConfig({ isOpen: true, message, title, onConfirm: onConfirmCallback });

  const handleTabSwitch = (newTab) => { if (!hideNav) navigate(`/terminal/${newTab}`); };

  return (
    <div style={{ fontFamily: "'Roboto', sans-serif" }} className="h-full">
      <style>{`@media print { @page { margin: 0; size: 80mm auto; } body { margin: 0; padding: 0; } body * { visibility: hidden !important; } #printable-receipt, #printable-receipt * { visibility: visible !important; } #printable-receipt { position: absolute; left: 0; top: 0; width: 80mm; margin: 0; padding: 4mm; } }`}</style>
      
      {/* Keeping identical local Modals context as original parent file */}
      {alertConfig.isOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] print:hidden px-4">
          <div className="bg-white border-2 border-[#0078D7] w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0078D7]">{alertConfig.title}</span>
              <button onClick={closeAlert} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm text-black">{alertConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end">
              <button onClick={closeAlert} className="px-8 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black">Acknowledge</button>
            </div>
          </div>
        </div>
      )}

      {confirmConfig.isOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] print:hidden px-4">
          <div className="bg-white border-2 border-[#0078D7] w-[400px] shadow-[0_4px_12px_rgba(0,0,0,0.15)] flex flex-col rounded-none">
            <div className="bg-white flex justify-between items-center pr-1 pl-4 py-1 border-b border-gray-200">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#0078D7]">{confirmConfig.title}</span>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="text-gray-600 hover:bg-[#e81123] hover:text-white px-3 py-1.5 leading-none transition-none focus:outline-none rounded-none">✕</button>
            </div>
            <div className="p-6 bg-white"><p className="text-sm text-black">{confirmConfig.message}</p></div>
            <div className="p-4 bg-[#f3f3f3] border-t border-gray-300 flex justify-end gap-2">
              <button onClick={() => { if (confirmConfig.onConfirm) confirmConfig.onConfirm(); setConfirmConfig({ ...confirmConfig, isOpen: false }); }} className="px-8 py-1.5 bg-[#0078D7] hover:bg-[#005a9e] text-white text-sm rounded-none border border-transparent focus:outline-none focus:ring-1 focus:ring-black">Execute</button>
              <button onClick={() => setConfirmConfig({ ...confirmConfig, isOpen: false })} className="px-8 py-1.5 bg-[#e6e6e6] hover:bg-[#cccccc] text-black border border-gray-400 text-sm rounded-none focus:outline-none focus:border-[#0078D7]">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col h-full w-full print:hidden font-sans">
        {!hideNav && (
          <div className="flex gap-1 mb-6 border-b border-gray-300 pb-0 overflow-x-auto whitespace-nowrap overflow-y-hidden">
            <button onClick={() => handleTabSwitch('dashboard')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${activeTab === 'dashboard' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Dashboard</button>
            <button onClick={() => handleTabSwitch('receive')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${activeTab === 'receive' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Inbound</button>
            <button onClick={() => handleTabSwitch('transfer')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${activeTab === 'transfer' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Transfer</button>
            <button onClick={() => handleTabSwitch('checkout')} className={`px-6 py-2 text-sm uppercase tracking-wider focus:outline-none rounded-none ${activeTab === 'checkout' ? 'bg-[#cce8ff] border-b-2 border-[#0078D7] text-black font-semibold' : 'bg-white border-b-2 border-transparent hover:bg-[#f3f3f3] text-gray-700 font-medium'}`}>Terminal</button>
          </div>
        )}

        {activeTab === 'dashboard' ? (
          <WorkerDashboardView />
        ) : (
          <WorkerTerminal activeTab={activeTab} shopSettings={shopSettings} cashierName={cashierName} refreshInventory={refreshInventory} showAlert={showAlert} showConfirm={showConfirm} isModalOpen={alertConfig.isOpen || confirmConfig.isOpen} />
        )}
      </div>
    </div>
  );
}