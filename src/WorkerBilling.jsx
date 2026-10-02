import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import WorkerDashboardView from './WorkerDashboardView';
import WorkerTerminal from './WorkerTerminal';
import WorkerScanner from './WorkerScanner';
import { CartProvider } from './contexts/CartContext';
import { PageLoader } from './SharedUI';

export default function WorkerBilling({ defaultTab = 'dashboard', hideNav = false }) {
  const { tab } = useParams();
  const activeTab = hideNav ? defaultTab : (tab || 'dashboard');
  const navigate = useNavigate();
  const { shopSettings, cashierName, userRole } = useApp();

  const { data: workerData, isLoading } = useQuery({
    queryKey: ['workerPermissions', cashierName],
    queryFn: async () => {
      const { data, error } = await supabase.from('workers').select('password').eq('name', cashierName).single();
      if (error) throw error;
      return data;
    },
    enabled: userRole !== 'owner',
  });

  const isBillable = userRole === 'owner' || !workerData?.password?.includes('NON_BILLABLE');

  const handleTabSwitch = (newTab) => {
    if (!hideNav) navigate(`/terminal/${newTab}`);
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[var(--bg-primary)]">
        <PageLoader text="Loading Workspace..." />
      </div>
    );
  }

  const tabs = [
    { key: 'dashboard', label: 'Dashboard' },
  ];
  if (isBillable) {
    tabs.push({ key: 'checkout', label: 'Terminal' });
  } else {
    tabs.push({ key: 'receive', label: 'Inbound' });
    tabs.push({ key: 'transfer', label: 'Transfer' });
    tabs.push({ key: 'scanner', label: 'Scanner' });
  }

  return (
    <div style={{ fontFamily: "var(--font-family)" }} className="h-full">
      <div className="flex flex-col h-full w-full">
        {!hideNav && activeTab !== 'dashboard' && (
          <div className="mb-4">
            <button
              onClick={() => handleTabSwitch('dashboard')}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-md text-[var(--color-accent)] bg-[var(--color-accent-bg)] hover:opacity-80 transition-opacity"
            >
              ← Back to Dashboard
            </button>
          </div>
        )}

        {activeTab === 'dashboard' ? (
          <WorkerDashboardView isBillable={isBillable} />
        ) : activeTab === 'scanner' ? (
          <WorkerScanner cashierName={cashierName} />
        ) : activeTab === 'checkout' && !isBillable ? (
          <div className="flex flex-col items-center justify-center h-full flex-1">
            <h2 className="text-xl font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-error)' }}>Access Denied</h2>
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Your account does not have checkout permissions.</p>
          </div>
        ) : (
          <CartProvider activeTab={activeTab}>
            <WorkerTerminal
              activeTab={activeTab}
              shopSettings={shopSettings}
              cashierName={cashierName}
            />
          </CartProvider>
        )}
      </div>
    </div>
  );
}