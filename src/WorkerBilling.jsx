import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { useApp } from './AppContext';
import WorkerDashboardView from './WorkerDashboardView';
import { CartProvider } from './contexts/CartContext';
import { PageLoader } from './SharedUI';

const WorkerTerminal = lazy(() => import('./WorkerTerminal'));
const WorkerScanner = lazy(() => import('./WorkerScanner'));
const WorkerPriceCheck = lazy(() => import('./WorkerPriceCheck'));
const OwnerLedger = lazy(() => import('./OwnerLedger'));
const OwnerExpenses = lazy(() => import('./OwnerExpenses'));
const WorkerPrintBarcode = lazy(() => import('./WorkerPrintBarcode'));
const ScrewBoxesView = lazy(() => import('./ScrewBoxesView'));

export default function WorkerBilling({ defaultTab = 'dashboard', hideNav = false }) {
  const { tab } = useParams();
  const activeTab = hideNav ? defaultTab : (tab || 'dashboard');
  const navigate = useNavigate();
  const { shopSettings, cashierName, userRole, isWarehouseDisabled } = useApp();

  const shopId = shopSettings?.id || localStorage.getItem('shop_id');

  const handleTabSwitch = (newTab) => {
    if (!hideNav) navigate(`/terminal/${newTab}`);
  };

  useEffect(() => {
    if (!hideNav && activeTab === 'transfer' && isWarehouseDisabled) {
      navigate('/terminal/dashboard', { replace: true });
    }

    const handleKeyDown = (e) => {
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        handleTabSwitch('dashboard');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isWarehouseDisabled, hideNav, navigate]);

  const { data: workerData, isLoading } = useQuery({
    queryKey: ['workerPermissions', shopId, cashierName],
    queryFn: async () => {
      let query = supabase.from('workers').select('password').eq('name', cashierName);
      if (shopId) {
        query = query.eq('shop_id', shopId);
      }
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: userRole !== 'owner' && !!cashierName,
  });

  // Remember the last known billing permission so a non-billable worker doesn't get the
  // checkout while permissions are loading or unavailable (e.g. offline). Workers we have
  // never seen keep the previous default (billable) so offline cashiers are not blocked.
  const billableCacheKey = `pos_worker_billable_${shopId || 'default'}_${cashierName}`;
  useEffect(() => {
    if (userRole === 'owner' || !workerData) return;
    try {
      localStorage.setItem(billableCacheKey, String(!workerData.password?.includes('NON_BILLABLE')));
    } catch (e) { /* storage full / unavailable */ }
  }, [workerData, billableCacheKey, userRole]);

  let isBillable;
  if (userRole === 'owner') {
    isBillable = true;
  } else if (workerData) {
    isBillable = !workerData.password?.includes('NON_BILLABLE');
  } else {
    let cached = null;
    try { cached = localStorage.getItem(billableCacheKey); } catch (e) { /* ignore */ }
    isBillable = cached !== 'false';
  }

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
    tabs.push({ key: 'print-barcode', label: 'Print Barcodes' });
    tabs.push({ key: 'expenses', label: 'Expenses' });
    tabs.push({ key: 'screw-boxes', label: 'Screw Boxes' });
  } else {
    tabs.push({ key: 'receive', label: 'Inbound' });
    if (!isWarehouseDisabled) {
      tabs.push({ key: 'transfer', label: 'Transfer' });
    }
    tabs.push({ key: 'lookup', label: 'Item Lookup' });
    tabs.push({ key: 'scanner', label: 'Scanner' });
  }

  return (
    <div style={{ fontFamily: "var(--font-family)" }} className="h-full min-h-0 flex flex-col flex-1">
      <div className="flex flex-col h-full w-full min-h-0 flex-1">
        {!hideNav && activeTab !== 'dashboard' && (
          <div className="pt-3 px-4 md:pt-2 md:px-0 mb-2">
            <button
              type="button"
              onClick={() => handleTabSwitch('dashboard')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs md:text-sm font-bold rounded-xl text-[var(--color-accent)] bg-[var(--color-accent-bg)] border border-[var(--color-accent)]/20 hover:opacity-80 active:scale-95 transition-all shadow-sm cursor-pointer"
            >
              <span>← Back to Dashboard</span>
            </button>
          </div>
        )}

        <Suspense fallback={<div className="w-full h-full flex-1 flex flex-col items-center justify-center min-h-[300px] p-8"><PageLoader text="Loading..." /></div>}>
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
          ) : activeTab === 'screw-boxes' ? (
            isBillable ? (
              <ScrewBoxesView />
            ) : (
              <div className="flex flex-col items-center justify-center h-full flex-1">
                <h2 className="text-xl font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-error)' }}>Access Denied</h2>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Opening screw boxes is only available for billable accounts.</p>
              </div>
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
          ) : (activeTab === 'sales' || activeTab === 'returns') ? (
            isBillable ? (
              <div className="h-full p-2 md:p-4 overflow-y-auto">
                <OwnerLedger isActive={true} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full flex-1">
                <h2 className="text-xl font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-error)' }}>Access Denied</h2>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Sales & Returns are only accessible by billable accounts.</p>
              </div>
            )
          ) : activeTab === 'print-barcode' ? (
            isBillable ? (
              <div className="h-full p-2 md:p-4 overflow-hidden flex flex-col flex-1 min-h-0">
                <WorkerPrintBarcode />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full flex-1">
                <h2 className="text-xl font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--color-error)' }}>Access Denied</h2>
                <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Print Barcode is only accessible by billable accounts.</p>
              </div>
            )
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
        </Suspense>
      </div>
    </div>
  );
}