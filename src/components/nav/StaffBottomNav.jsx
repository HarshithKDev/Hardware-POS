import { useState } from 'react';
import { LayoutDashboard, ShoppingCart, History, Receipt, Printer, Package, PackagePlus, ArrowLeftRight, Search, ScanLine, Menu } from 'lucide-react';
import { Modal } from '../ui';

const ICONS = {
  dashboard: LayoutDashboard, checkout: ShoppingCart, sales: History, expenses: Receipt,
  'print-barcode': Printer, 'screw-boxes': Package, receive: PackagePlus, transfer: ArrowLeftRight,
  lookup: Search, scanner: ScanLine,
};
const SHORT = {
  dashboard: 'Home', checkout: 'Checkout', sales: 'Sales', expenses: 'Expenses', 'print-barcode': 'Labels',
  'screw-boxes': 'Screw Boxes', receive: 'Receive', transfer: 'Transfer', lookup: 'Lookup', scanner: 'Scanner',
};
// What goes on the bar first when there are more screens than fit
const PRIORITY = ['dashboard', 'checkout', 'sales', 'expenses', 'receive', 'transfer', 'lookup', 'scanner', 'print-barcode', 'screw-boxes'];

/**
 * Phone-only bottom navigation for staff (desktop keeps the dashboard tiles and the
 * "Back to Dashboard" button). Up to 5 buttons; extra screens go under "More".
 */
export default function StaffBottomNav({ tabs, activeTab, onSelect }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const ordered = [...tabs].sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
  const onBar = ordered.length <= 5 ? ordered : ordered.slice(0, 4);
  const inMore = ordered.length <= 5 ? [] : ordered.slice(4);
  const moreActive = inMore.some(t => t.key === activeTab);

  const item = (key, label, Icon, active, onClick) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className="flex-1 min-w-0 flex flex-col items-center justify-center h-full py-1 gap-0.5 transition-colors focus:outline-none"
      style={{ color: active ? 'var(--color-accent)' : 'var(--text-secondary)' }}
    >
      <Icon size={19} strokeWidth={active ? 2.5 : 2} />
      <span className="text-xs font-semibold tracking-tight truncate max-w-full">{label}</span>
    </button>
  );

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-[var(--border-medium)] shadow-lg"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          height: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
        aria-label="Staff navigation"
      >
        {onBar.map(t => item(t.key, SHORT[t.key] || t.label, ICONS[t.key] || LayoutDashboard, activeTab === t.key, () => onSelect(t.key)))}
        {inMore.length > 0 && item('more', 'More', Menu, moreActive || moreOpen, () => setMoreOpen(true))}
      </nav>

      <Modal isOpen={moreOpen} onClose={() => setMoreOpen(false)} title="More" titleId="staff-more-title" size="sm" closeOnBackdrop>
        <div className="flex flex-col gap-2">
          {inMore.map(t => {
            const Icon = ICONS[t.key] || LayoutDashboard;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => { setMoreOpen(false); onSelect(t.key); }}
                className="flex items-center gap-3 h-14 px-4 rounded-lg border text-left text-base font-semibold transition-colors hover:bg-[var(--bg-hover)]"
                style={{ borderColor: active ? 'var(--color-accent)' : 'var(--border-medium)', color: active ? 'var(--color-accent)' : 'var(--text-primary)' }}
              >
                <Icon size={20} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
