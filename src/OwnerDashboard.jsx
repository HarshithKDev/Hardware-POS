import { useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from './AppContext';
import OwnerStats from './OwnerStats';
import OwnerCatalog from './OwnerCatalog';
import OwnerInventory from './OwnerInventory';
import OwnerLedger from './OwnerLedger';
import OwnerStaff from './OwnerStaff';
import WorkerBilling from './WorkerBilling';
import OwnerCategories from './OwnerCategories';

export default function OwnerDashboard() {
  const { tab } = useParams();
  const activeTab = tab || 'dashboard';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { shopSettings, cashierName } = useApp();

  // Separate URL param keys so warehouse and store subtabs don't collide
  const warehouseSubTab = searchParams.get('wsub') || 'inventory';
  const storeSubTab = searchParams.get('ssub') || 'inventory';

  const changeTab = (newTab) => {
    navigate(`/owner/${newTab}`);
    setIsSidebarOpen(false);
  };

  return (
    <div
      className="flex flex-col md:flex-row h-full shadow-none"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      {/* MOBILE MENU TOGGLE */}
      <div
        className="md:hidden flex justify-between items-center p-4"
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-medium)',
        }}
      >
        <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          Menu
        </span>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="px-4 py-1.5 text-sm focus:outline-none"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
          }}
          aria-label="Toggle sidebar menu"
          aria-expanded={isSidebarOpen}
        >
          ☰
        </button>
      </div>

      {/* SIDEBAR */}
      <aside
        className={`${isSidebarOpen ? 'block' : 'hidden'} md:block w-full md:w-[240px] flex-shrink-0 pt-4`}
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          borderRight: '1px solid var(--border-medium)',
        }}
        role="navigation"
        aria-label="Dashboard navigation"
      >
        <div className="flex flex-col gap-1">
          {[
            { key: 'dashboard', label: 'Overview' },
            { key: 'register', label: 'Add Items' },
            { key: 'categories', label: 'Categories' },
            { key: 'warehouse', label: 'Main Storage' },
            { key: 'store', label: 'Shop Front' },
            { key: 'sales', label: 'Sales History' },
            { key: 'staff', label: 'Manage Staff' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => changeTab(key)}
              className="text-left px-6 py-2.5 text-sm focus:outline-none"
              style={{
                backgroundColor: activeTab === key ? 'var(--color-accent)' : 'transparent',
                color: activeTab === key ? '#ffffff' : 'var(--text-secondary)',
                fontWeight: activeTab === key ? '600' : '400',
                borderLeft: activeTab === key
                  ? '4px solid var(--color-accent-hover)'
                  : '4px solid transparent',
              }}
              aria-current={activeTab === key ? 'page' : undefined}
            >
              {label}
            </button>
          ))}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main
        className="flex-1 p-4 md:p-8 overflow-y-auto relative"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
        role="main"
        aria-label="Dashboard content"
      >
        {activeTab === 'dashboard' && <OwnerStats isActive={true} />}

        {activeTab === 'register' && <OwnerCatalog />}

        {activeTab === 'categories' && <OwnerCategories />}

        {activeTab === 'warehouse' && (
          <div className="flex flex-col h-full animate-fade-in">
            <h1 className="text-2xl font-light mb-6" style={{ color: 'var(--text-primary)' }}>
              Main Storage Actions
            </h1>
            <div
              className="flex gap-1 mb-6 pb-0"
              style={{ borderBottom: '1px solid var(--border-light)' }}
              role="tablist"
              aria-label="Warehouse tabs"
            >
              {[
                { key: 'inventory', label: 'All Items' },
                { key: 'receive', label: 'Receive Stock' },
                { key: 'transfer', label: 'Move to Shop' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSearchParams({ wsub: key })}
                  className="px-6 py-2 text-sm uppercase tracking-wider focus:outline-none"
                  style={{
                    backgroundColor: warehouseSubTab === key ? 'var(--color-accent)' : 'var(--bg-secondary)',
                    color: warehouseSubTab === key ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: warehouseSubTab === key ? '600' : '500',
                    borderBottom: warehouseSubTab === key
                      ? '2px solid var(--color-accent-hover)'
                      : '2px solid transparent',
                  }}
                  role="tab"
                  aria-selected={warehouseSubTab === key}
                >
                  {label}
                </button>
              ))}
            </div>
            {warehouseSubTab === 'inventory' && <OwnerInventory viewType="warehouse" />}
            {warehouseSubTab === 'receive' && (
              <div style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }} className="flex-1 mb-4">
                <WorkerBilling defaultTab="receive" hideNav={true} />
              </div>
            )}
            {warehouseSubTab === 'transfer' && (
              <div style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }} className="flex-1 mb-4">
                <WorkerBilling defaultTab="transfer" hideNav={true} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'store' && (
          <div className="flex flex-col h-full animate-fade-in">
            <h1 className="text-2xl font-light mb-6" style={{ color: 'var(--text-primary)' }}>
              Shop Front Actions
            </h1>
            <div
              className="flex gap-1 mb-6 pb-0"
              style={{ borderBottom: '1px solid var(--border-light)' }}
              role="tablist"
              aria-label="Store tabs"
            >
              {[
                { key: 'inventory', label: 'Items in Shop' },
                { key: 'checkout', label: 'Checkout Counter' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSearchParams({ ssub: key })}
                  className="px-6 py-2 text-sm uppercase tracking-wider focus:outline-none"
                  style={{
                    backgroundColor: storeSubTab === key ? 'var(--color-accent)' : 'var(--bg-secondary)',
                    color: storeSubTab === key ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: storeSubTab === key ? '600' : '500',
                    borderBottom: storeSubTab === key
                      ? '2px solid var(--color-accent-hover)'
                      : '2px solid transparent',
                  }}
                  role="tab"
                  aria-selected={storeSubTab === key}
                >
                  {label}
                </button>
              ))}
            </div>
            {storeSubTab === 'inventory' && <OwnerInventory viewType="store" />}
            {storeSubTab === 'checkout' && (
              <div style={{ border: '1px solid var(--border-medium)', backgroundColor: 'var(--bg-secondary)' }} className="flex-1 mb-4">
                <WorkerBilling defaultTab="checkout" hideNav={true} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'sales' && (
          <div className="block h-full animate-fade-in">
            <OwnerLedger isActive={true} />
          </div>
        )}

        {activeTab === 'staff' && (
          <div className="block h-full animate-fade-in">
            <OwnerStaff />
          </div>
        )}
      </main>
    </div>
  );
}