import { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from './AppContext';
import { PageLoader } from './SharedUI';
import OwnerStats from './OwnerStats';

const OwnerCatalog = lazy(() => import('./OwnerCatalog'));
const OwnerInventory = lazy(() => import('./OwnerInventory'));
const OwnerLedger = lazy(() => import('./OwnerLedger'));
const OwnerStaff = lazy(() => import('./OwnerStaff'));
const WorkerBilling = lazy(() => import('./WorkerBilling'));
const OwnerCategories = lazy(() => import('./OwnerCategories'));
const OwnerAuditLogs = lazy(() => import('./OwnerAuditLogs'));
const OwnerSettings = lazy(() => import('./OwnerSettings'));
const OwnerExpenses = lazy(() => import('./OwnerExpenses'));
const OwnerShowroom = lazy(() => import('./OwnerShowroom'));
const BatchDetailsView = lazy(() => import('./BatchDetailsView'));
import { 
  LayoutDashboard, 
  Plus, 
  Tags, 
  Warehouse, 
  Boxes,
  ShoppingCart, 
  History, 
  Users, 
  Search, 
  Menu,
  Settings,
  Undo2,
  Receipt,
  Store
} from 'lucide-react';

export default function OwnerDashboard() {
  const { isWarehouseDisabled } = useApp();
  const { tab } = useParams();
  const activeTab = tab || 'dashboard';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [selectedBatchBarcode, setSelectedBatchBarcode] = useState(null);

  const warehouseSubTab = searchParams.get('wsub') || 'inventory';

  useEffect(() => {
    if (isWarehouseDisabled && warehouseSubTab === 'transfer') {
      setSearchParams({ wsub: 'inventory' });
    }
  }, [isWarehouseDisabled, warehouseSubTab, setSearchParams]);

  const navItems = useMemo(() => [
    { key: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { key: 'register', label: 'Add Items', icon: Plus },
    { key: 'categories', label: 'Categories', icon: Tags },
    { key: 'warehouse', label: isWarehouseDisabled ? 'Store Inventory' : 'Main Storage', icon: isWarehouseDisabled ? Boxes : Warehouse },
    { key: 'checkout', label: 'Checkout', icon: ShoppingCart },
    { key: 'sales', label: 'Sales & Returns', icon: History },
    { key: 'showroom', label: 'Showroom', icon: Store },
    { key: 'staff', label: 'Manage Staff', icon: Users },
    { key: 'expenses', label: 'Expenses', icon: Receipt },
    { key: 'audit', label: 'Audit Logs', icon: Search },
    { key: 'settings', label: 'Shop Settings', icon: Settings },
  ], [isWarehouseDisabled]);

  const changeTab = (newTab) => {
    setSelectedBatchBarcode(null);
    navigate(`/owner/${newTab}`);
    setIsSidebarOpen(false);
  };

  return (
    <div className="flex flex-col md:flex-row h-full overflow-hidden relative md:gap-4" style={{ backgroundColor: 'transparent' }}>
      {/* MOBILE MENU TOGGLE */}
      <div
        className="md:hidden flex justify-between items-center px-4 py-2.5 shrink-0"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-light)',
        }}
      >
        <span className="text-sm font-bold tracking-wide uppercase truncate" style={{ color: 'var(--text-primary)' }}>
          {navItems.find(item => item.key === activeTab)?.label || 'Hardware POS'}
        </span>
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="px-2.5 py-1.5 rounded-md flex items-center gap-1.5 text-xs font-semibold focus:outline-none transition-colors"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-medium)',
          }}
          aria-label="Toggle navigation drawer"
          aria-expanded={isSidebarOpen}
        >
          <Menu size={16} />
          <span className="text-[11px] uppercase tracking-wider">All Tabs</span>
        </button>
      </div>

      {/* Overlay for mobile drawer */}
      {isSidebarOpen && (
        <div 
          className="md:hidden fixed inset-0 z-40 transition-opacity" 
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
          absolute md:relative top-0 left-0 h-full md:h-full z-50
          w-64 md:w-56 flex-shrink-0 py-3 md:py-4
          m-0 md:rounded-xl 
          border-r md:border border-[var(--border-medium)] md:border-[var(--border-light)] 
          shadow-2xl md:shadow-sm transition-transform duration-300 ease-in-out
          overflow-y-auto
        `}
        style={{
          backgroundColor: 'var(--bg-secondary)',
        }}
        role="navigation"
        aria-label="Dashboard navigation"
      >
        <div className="flex flex-col gap-0.5 md:gap-1 px-2.5 md:px-3">
          {navItems.map(({ key, label, icon: Icon }) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                onClick={() => changeTab(key)}
                className={`relative overflow-hidden text-left pl-3.5 pr-2.5 py-2 my-0.5 rounded-lg text-sm flex items-center gap-2.5 md:gap-3 transition-all duration-200 shrink-0 ${
                  isActive 
                    ? 'bg-[var(--bg-tertiary)] text-[var(--color-accent)] font-semibold shadow-sm' 
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-[var(--color-accent)]" />
                )}
                <Icon size={18} className={isActive ? 'text-[var(--color-accent)]' : 'text-[var(--text-tertiary)]'} />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main
        className="flex-1 min-w-0 flex flex-col p-3 pb-20 md:p-4 overflow-y-auto overflow-x-hidden relative m-0 rounded-none md:rounded-xl border-0 md:border border-transparent md:border-[var(--border-light)] shadow-sm"
        style={{ backgroundColor: 'var(--bg-secondary)', overscrollBehavior: 'none' }}
        role="main"
        aria-label="Dashboard content"
      >
        <Suspense fallback={<div className="w-full h-full flex flex-1 flex-col items-center justify-center min-h-[300px] p-8"><PageLoader text="Loading view..." /></div>}>
        {activeTab === 'dashboard' && <OwnerStats isActive={true} />}

        {activeTab === 'register' && <OwnerCatalog />}

        {activeTab === 'categories' && <OwnerCategories />}

        {activeTab === 'warehouse' && (
          selectedBatchBarcode ? (
            <BatchDetailsView
              barcode={selectedBatchBarcode}
              onBack={() => setSelectedBatchBarcode(null)}
              viewType={warehouseSubTab}
            />
          ) : (
            <div className="flex flex-col flex-1 h-full animate-fade-in">
              <h1 className="text-2xl font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
                {isWarehouseDisabled ? 'Store Inventory Actions' : 'Main Storage Actions'}
              </h1>
              <div
                className="flex gap-1 mb-6 pb-0 overflow-x-hidden border-b border-[var(--border-light)]"
                role="tablist"
                aria-label="Inventory tabs"
              >
                {[
                  { key: 'inventory', label: 'All Items' },
                  { key: 'receive', label: 'Receive Stock' },
                  ...(!isWarehouseDisabled ? [{ key: 'transfer', label: 'Move to Shop' }] : []),
                  { key: 'recycle', label: 'Recycle Bin' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setSelectedBatchBarcode(null);
                      setSearchParams({ wsub: key });
                    }}
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
              {warehouseSubTab === 'inventory' && (
                <OwnerInventory 
                  viewType="warehouse" 
                  onOpenBatchDetails={(item) => setSelectedBatchBarcode(item.barcode)}
                />
              )}
              {warehouseSubTab === 'receive' && (
                <div className="flex-1 rounded-lg overflow-hidden border border-[var(--border-light)] bg-[var(--bg-secondary)]">
                  <WorkerBilling defaultTab="receive" hideNav={true} />
                </div>
              )}
              {warehouseSubTab === 'transfer' && !isWarehouseDisabled && (
                <div className="flex-1 rounded-lg overflow-hidden border border-[var(--border-light)] bg-[var(--bg-secondary)]">
                  <WorkerBilling defaultTab="transfer" hideNav={true} />
                </div>
              )}
              {warehouseSubTab === 'recycle' && (
                <OwnerInventory 
                  viewType="recycle" 
                  onOpenBatchDetails={(item) => setSelectedBatchBarcode(item.barcode)}
                />
              )}
            </div>
          )
        )}

        {activeTab === 'checkout' && (
          <div className="flex flex-col h-full animate-fade-in">
            <div className="flex-1 rounded-lg overflow-hidden border border-[var(--border-light)] bg-[var(--bg-secondary)]">
              <WorkerBilling defaultTab="checkout" hideNav={true} />
            </div>
          </div>
        )}

        {activeTab === 'sales' && (
          <div className="block h-full animate-fade-in">
            <OwnerLedger isActive={true} />
          </div>
        )}

        {activeTab === 'showroom' && (
          <div className="block h-full animate-fade-in">
            <OwnerShowroom />
          </div>
        )}

        { activeTab === 'returns' && (
          <div className="block h-full animate-fade-in">
            <OwnerLedger isActive={true} />
          </div>
        )}

        {activeTab === 'staff' && (
          <div className="block h-full animate-fade-in">
            <OwnerStaff />
          </div>
        )}

        {activeTab === 'expenses' && (
          <div className="block h-full animate-fade-in">
            <OwnerExpenses isOwner={true} />
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="block h-full animate-fade-in">
            <OwnerAuditLogs />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex-1 min-h-0 h-full animate-fade-in">
            <OwnerSettings />
          </div>
        )}
        </Suspense>
      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around h-14 border-t border-[var(--border-medium)] shadow-lg"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        aria-label="Mobile Bottom Navigation"
      >
        {[
          { key: 'dashboard', label: 'Overview', icon: LayoutDashboard },
          { key: 'warehouse', label: isWarehouseDisabled ? 'Store' : 'Inventory', icon: isWarehouseDisabled ? Boxes : Warehouse },
          { key: 'checkout', label: 'Checkout', icon: ShoppingCart },
          { key: 'sales', label: 'Sales', icon: History },
          { key: 'more', label: 'More', icon: Menu, isMore: true },
        ].map(({ key, label, icon: Icon, isMore }) => {
          const isActive = !isMore && activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (isMore) {
                  setIsSidebarOpen(prev => !prev);
                } else {
                  changeTab(key);
                }
              }}
              className="flex-1 flex flex-col items-center justify-center h-full py-1 gap-0.5 transition-colors focus:outline-none"
              style={{
                color: (isActive || (isMore && isSidebarOpen)) ? 'var(--color-accent)' : 'var(--text-secondary)',
              }}
              aria-label={label}
            >
              <Icon size={19} strokeWidth={(isActive || (isMore && isSidebarOpen)) ? 2.5 : 2} />
              <span className="text-[10px] font-semibold tracking-tight">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}