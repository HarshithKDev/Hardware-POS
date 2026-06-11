import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import WorkerDashboardView from './WorkerDashboardView';
import WorkerTerminal from './WorkerTerminal';
import WorkerScanner from './WorkerScanner';

export default function WorkerBilling({ defaultTab = 'dashboard', hideNav = false }) {
  const { tab } = useParams();
  const activeTab = hideNav ? defaultTab : (tab || 'dashboard');
  const navigate = useNavigate();
  const { shopSettings, cashierName } = useApp();

  const { data: workerData, isLoading } = useQuery({
    queryKey: ['workerPermissions', cashierName],
    queryFn: async () => {
      const { data, error } = await supabase.from('workers').select('password').eq('name', cashierName).single();
      if (error) throw error;
      return data;
    },
    enabled: cashierName !== 'owner',
  });

  // Default to true while loading so we don't flash hiding the tab
  const isBillable = cashierName === 'owner' || isLoading || !workerData?.password?.includes('NON_BILLABLE');

  const handleTabSwitch = (newTab) => {
    if (!hideNav) navigate(`/terminal/${newTab}`);
  };

  const tabs = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'receive', label: 'Inbound' },
    { key: 'transfer', label: 'Transfer' },
  ];
  if (isBillable) {
    tabs.push({ key: 'checkout', label: 'Terminal' });
  } else {
    tabs.push({ key: 'scanner', label: 'Scanner' });
  }

  return (
    <div style={{ fontFamily: "var(--font-family)" }} className="h-full">
      <style>{`
        @media print { 
          @page { margin: 0; size: 80mm auto; } 
          body { margin: 0; padding: 0; background: #ffffff !important; } 
          body * { visibility: hidden; } 
          #printable-receipt, #printable-receipt * { visibility: visible; } 
          #printable-receipt { position: absolute; left: 0; top: 0; width: 80mm; padding: 4mm; } 
        }
      `}</style>

      <div className="flex flex-col h-full w-full font-sans">
        {!hideNav && (
          <div
            className="flex gap-1 mb-6 pb-0 overflow-x-auto whitespace-nowrap overflow-y-hidden print:hidden"
            style={{ borderBottom: '1px solid var(--border-light)' }}
            role="tablist"
            aria-label="Terminal tabs"
          >
            {tabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleTabSwitch(key)}
                className="px-6 py-2 text-sm uppercase tracking-wider focus:outline-none"
                style={{
                  backgroundColor: activeTab === key ? 'var(--color-accent-bg)' : 'var(--bg-secondary)',
                  color: activeTab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: activeTab === key ? '600' : '500',
                  borderBottom: activeTab === key
                    ? '2px solid var(--color-accent)'
                    : '2px solid transparent',
                }}
                role="tab"
                aria-selected={activeTab === key}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {activeTab === 'dashboard' ? (
          <WorkerDashboardView />
        ) : activeTab === 'scanner' ? (
          <WorkerScanner cashierName={cashierName} />
        ) : activeTab === 'checkout' && !isBillable ? (
          <div className="flex flex-col items-center justify-center h-full flex-1">
            <h2 className="text-xl font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-error)' }}>Access Denied</h2>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Your account does not have billing permissions.</p>
          </div>
        ) : (
          <WorkerTerminal
            activeTab={activeTab}
            shopSettings={shopSettings}
            cashierName={cashierName}
          />
        )}
      </div>
    </div>
  );
}