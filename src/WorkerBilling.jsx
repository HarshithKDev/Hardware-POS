import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import WorkerDashboardView from './WorkerDashboardView';
import WorkerTerminal from './WorkerTerminal';
import WorkerScanner from './WorkerScanner';
import WorkerPriceCheck from './WorkerPriceCheck';
import OwnerLedger from './OwnerLedger';
import OwnerExpenses from './OwnerExpenses';
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
    tabs.push({ key: 'sales', label: 'Sales & Returns' });
    tabs.push({ key: 'expenses', label: 'Expenses' });
  } else {
    tabs.push({ key: 'receive', label: 'Inbound' });
    tabs.push({ key: 'transfer', label: 'Transfer' });
    tabs.push({ key: 'lookup', label: 'Item Lookup' });
    tabs.push({ key: 'scanner', label: 'Scanner' });
  }

  return (
    <div style={{ fontFamily: "var(--font-family)" }} className="h-full min-h-0">
      <div className="flex flex-col h-full w-full min-h-0">
        {!hideNav && activeTab !== 'dashboard' && (
          <div className="pt-3 px-4 md:pt-2 md:px-0 mb-2">
            <button
              onClick={() => handleTabSwitch('dashboard')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs md:text-sm font-bold uppercase tracking-wider rounded-xl text-[var(--color-accent)] bg-[var(--color-accent-bg)] border border-[var(--color-accent)]/20 hover:opacity-80 active:scale-95 transition-all shadow-sm"
            >
              ← Back to Dashboard
            </button>
          </div>
        )}

        {activeTab === 'dashboard' ? (
          <WorkerDashboardView isBillable={isBillable} />
        ) : activeTab === 'scanner' ? (
          isBillable ? (
            <div className="flex flex-col items-center justify-center h-full flex-1">
              <h2 className="text-xl font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-error)' }}>Access Denied</h2>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Scanner is only available for non-billable helper accounts.</p>
            </div>
          ) : (
            <WorkerScanner cashierName={cashierName} />
          )
        ) : (activeTab === 'lookup' || activeTab === 'price-check') ? (
          isBillable ? (
            <div className="flex flex-col items-center justify-center h-full flex-1">
              <h2 className="text-xl font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-error)' }}>Access Denied</h2>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Item Lookup is only available for non-billable helper accounts.</p>
            </div>
          ) : (
            <WorkerPriceCheck />
          )
        ) : activeTab === 'expenses' ? (
          isBillable ? (
            <OwnerExpenses isOwner={false} cashierName={cashierName} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full flex-1">
              <h2 className="text-xl font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-error)' }}>Access Denied</h2>
              <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Expenses are only accessible by billable accounts.</p>
            </div>
          )
        ) : (activeTab === 'sales' || activeTab === 'returns') && isBillable ? (
          <div className="h-full p-4 overflow-y-auto">
            <OwnerLedger isActive={true} />
          </div>
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