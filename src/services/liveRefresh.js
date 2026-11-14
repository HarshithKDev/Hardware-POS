import { supabase } from '../supabaseClient';
import { POS_EVENT } from './posEvents';

// When any device records a sale, return, showroom dispatch, expense or other logged
// action, refresh the screens that show that data on every other open device (owner
// dashboard, sales ledger, showroom, audit logs, expenses) instead of waiting up to
// 5 minutes for their cached data to expire.

const BILL_QUERY_KEYS = [
  'bills', 'billAvailableDates', 'bill_items',
  'dashboard-stats', 'dashboard-sales-stats',
  'sales-trend', 'owner-reports', 'stats', 'lowStockCounts',
  'showroom-sales', 'showroom-sales-total', 'showroom_bill_items',
];
const AUDIT_QUERY_KEYS = ['unifiedAuditLogs', 'auditAvailableDates'];

export const EXPENSES_CHANGED_EVENT = 'pos_expenses_changed';

let channel = null;
let timers = {};

const debounce = (key, fn, ms = 1200) => {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, ms);
};

// Stock figures on the Overview (capital, low stock, dead stock) read the whole catalog, so
// after sales they refresh at most once a minute instead of after every single bill.
export const INVENTORY_REFRESH_MS = 60 * 1000;
let lastInventoryRefresh = 0;
const refreshInventoryStats = (invalidate) => {
  if (timers.inventory) return; // a refresh is already on its way
  const wait = Math.max(1200, lastInventoryRefresh + INVENTORY_REFRESH_MS - Date.now());
  timers.inventory = setTimeout(() => {
    timers.inventory = null;
    lastInventoryRefresh = Date.now();
    invalidate(['dashboard-inventory-stats']);
  }, wait);
};

let onPosEvent = null;

export function startLiveRefresh(queryClient, shopId) {
  if (channel || !supabase?.channel || !shopId) return;
  const invalidate = (keys) => keys.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  const filter = `shop_id=eq.${shopId}`;
  const onBillChanged = () => {
    debounce('bills', () => invalidate([...BILL_QUERY_KEYS, ...AUDIT_QUERY_KEYS]));
    refreshInventoryStats(invalidate);
  };

  // Sales, returns and dispatches arrive through the shop's single "something changed"
  // subscription (started by the background sync), not a separate one on the bills table
  onPosEvent = (e) => { if (e?.detail?.kind === 'bill') onBillChanged(); };
  window.addEventListener(POS_EVENT, onPosEvent);

  // Audit entries and expenses are not part of that signal
  channel = supabase
    .channel(`pos_live_${shopId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs', filter },
      () => debounce('audit', () => invalidate(AUDIT_QUERY_KEYS)))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter },
      () => debounce('expenses', () => {
        invalidate(['dashboard-stats', 'dashboard-sales-stats', 'stats']);
        window.dispatchEvent(new CustomEvent(EXPENSES_CHANGED_EVENT));
      }))
    .subscribe();
}

export function stopLiveRefresh() {
  Object.values(timers).forEach(clearTimeout);
  timers = {};
  lastInventoryRefresh = 0;
  if (channel) {
    try { supabase.removeChannel(channel); } catch (e) { /* ignore */ }
    channel = null;
  }
  if (onPosEvent) {
    window.removeEventListener(POS_EVENT, onPosEvent);
    onPosEvent = null;
  }
}
