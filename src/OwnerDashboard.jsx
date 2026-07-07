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
import OwnerAuditLogs from './OwnerAuditLogs';
import { 
  LayoutDashboard, 
  Plus, 
  Tags, 
  Warehouse, 
  ShoppingCart, 
  History, 
  Users, 
  Search, 
  Menu 
} from 'lucide-react';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { key: 'register', label: 'Add Items', icon: Plus },
  { key: 'categories', label: 'Categories', icon: Tags },
  { key: 'warehouse', label: 'Main Storage', icon: Warehouse },
  { key: 'checkout', label: 'Checkout', icon: ShoppingCart },
  { key: 'sales', label: 'Sales History', icon: History },
  { key: 'staff', label: 'Manage Staff', icon: Users },
  { key: 'audit', label: 'Audit Logs', icon: Search },
];

export default function OwnerDashboard() {
  const { tab } = useParams();
  const activeTab = tab || 'dashboard';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const warehouseSubTab = searchParams.get('wsub') || 'inventory';

  const changeTab = (newTab) => {
    navigate(`/owner/${newTab}`);
    setIsSidebarOpen(false);
  };

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden relative" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* MOBILE MENU TOGGLE */}
      <div
        className="md:hidden flex justify-between items-center p-4"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-light)',
        }}
      >
        <span className="text-base font-bold tracking-wide uppercase" style={{ color: 'var(--text-primary)' }}>
          {NAV_ITEMS.find(item => item.key === activeTab)?.label || 'Hardware POS'}
        </span>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-2 rounded-md"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
          }}
          aria-label="Toggle sidebar menu"
          aria-expanded={isSidebarOpen}
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Overlay for mobile drawer */}
      {isSidebarOpen && (
        <div 
          className="md:hidden absolute inset-0 z-40 transition-opacity" 
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }} 
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Navigation Sidebar */}
      <aside
        className={`
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} 
          md:translate-x-0 
          absolute md:relative top-0 left-0 h-full z-50
          w-64 md:w-56 flex-shrink-0 py-4 
          m-0 md:m-4 md:mr-2 rounded-r-2xl md:rounded-xl 
          border-r md:border border-[var(--border-medium)] md:border-[var(--border-light)] 
          shadow-2xl md:shadow-sm transition-transform duration-300 ease-in-out
        `}
        style={{
          backgroundColor: 'var(--bg-secondary)',
        }}
        role="navigation"
        aria-label="Dashboard navigation"
      >
        <div className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => changeTab(key)}
                className={`text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors border-l-2 ${isActive ? 'border-[var(--color-accent)] bg-[var(--bg-tertiary)] text-[var(--color-accent)] font-medium' : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'}`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={18} className={isActive ? 'text-[var(--color-accent)]' : 'text-[var(--text-tertiary)]'} />
                {label}
              </button>
            );
          })}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main
        className="flex-1 p-2 md:p-6 md:pb-2 overflow-y-auto relative m-0 md:m-4 md:ml-2 rounded-none md:rounded-xl border-0 md:border border-transparent md:border-[var(--border-light)] shadow-sm"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
        role="main"
        aria-label="Dashboard content"
      >
        {activeTab === 'dashboard' && <OwnerStats isActive={true} />}

        {activeTab === 'register' && <OwnerCatalog />}

        {activeTab === 'categories' && <OwnerCategories />}

        {activeTab === 'warehouse' && (
          <div className="flex flex-col h-full animate-fade-in">
            <h1 className="text-2xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
              Main Storage Actions
            </h1>
            <div
              className="flex gap-1 mb-6 pb-0 overflow-x-auto border-b border-[var(--border-light)]"
              role="tablist"
              aria-label="Warehouse tabs"
            >
              {[
                { key: 'inventory', label: 'All Items' },
                { key: 'receive', label: 'Receive Stock' },
                { key: 'transfer', label: 'Move to Shop' },
                { key: 'recycle', label: 'Recycle Bin' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSearchParams({ wsub: key })}
                  className="px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors relative"
                  style={{
                    color: warehouseSubTab === key ? 'var(--text-primary)' : 'var(--text-secondary)',
                    backgroundColor: 'transparent',
                    borderRadius: 0
                  }}
                  role="tab"
                  aria-selected={warehouseSubTab === key}
                >
                  {label}
                  {warehouseSubTab === key && (
                    <div className="absolute bottom-0 left-0 w-full h-[2px]" style={{ backgroundColor: 'var(--color-accent)' }} />
                  )}
                </button>
              ))}
            </div>
            {warehouseSubTab === 'inventory' && <OwnerInventory viewType="warehouse" />}
            {warehouseSubTab === 'receive' && (
              <div className="flex-1 mb-4 rounded-lg overflow-hidden border border-[var(--border-light)] bg-[var(--bg-secondary)]">
                <WorkerBilling defaultTab="receive" hideNav={true} />
              </div>
            )}
            {warehouseSubTab === 'transfer' && (
              <div className="flex-1 mb-4 rounded-lg overflow-hidden border border-[var(--border-light)] bg-[var(--bg-secondary)]">
                <WorkerBilling defaultTab="transfer" hideNav={true} />
              </div>
            )}
            {warehouseSubTab === 'recycle' && <OwnerInventory viewType="recycle" />}
          </div>
        )}

        {activeTab === 'checkout' && (
          <div className="flex flex-col h-full animate-fade-in">
            <div className="flex-1 mb-4 rounded-lg overflow-hidden border border-[var(--border-light)] bg-[var(--bg-secondary)]">
              <WorkerBilling defaultTab="checkout" hideNav={true} />
            </div>
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

        {activeTab === 'audit' && (
          <div className="block h-full animate-fade-in">
            <OwnerAuditLogs />
          </div>
        )}
      </main>
    </div>
  );
}