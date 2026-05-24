import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from './AppContext';
import WorkerDashboardView from './WorkerDashboardView';
import WorkerTerminal from './WorkerTerminal';

export default function WorkerBilling({ defaultTab = 'dashboard', hideNav = false }) {
  const { tab } = useParams();
  const activeTab = hideNav ? defaultTab : (tab || 'dashboard');
  const navigate = useNavigate();
  const { shopSettings, cashierName } = useApp();

  const handleTabSwitch = (newTab) => {
    if (!hideNav) navigate(`/terminal/${newTab}`);
  };

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
            {[
              { key: 'dashboard', label: 'Dashboard' },
              { key: 'receive', label: 'Inbound' },
              { key: 'transfer', label: 'Transfer' },
              { key: 'checkout', label: 'Terminal' },
            ].map(({ key, label }) => (
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