import { supabase } from '../supabaseClient';

// When any device records a sale, return, showroom dispatch, expense or other logged
// action, refresh the screens that show that data on every other open device (owner
// dashboard, sales ledger, showroom, audit logs, expenses) instead of waiting up to
// 5 minutes for their cached data to expire.

const BILL_QUERY_KEYS = [
  'bills', 'billAvailableDates', 'bill_items',
  'dashboard-stats', 'dashboard-sales-stats', 'dashboard-inventory-stats',
  'sales-trend', 'owner-reports', 'stats', 'lowStockCounts',
  'showroom-sales', 'showroom-sales-total', 'showroom_bill_items',
];
const AUDIT_QUERY_KEYS = ['unifiedAuditLogs', 'auditAvailableDates'];

export const EXPENSES_CHANGED_EVENT = 'pos_expenses_changed';

let channel = null;
let eventsChannel = null;
let timers = {};

const debounce = (key, fn, ms = 1200) => {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(fn, ms);
};

export function startLiveRefresh(queryClient, shopId) {
  if (channel || !supabase?.channel || !shopId) return;
  const invalidate = (keys) => keys.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
  const filter = `shop_id=eq.${shopId}`;

  channel = supabase
    .channel(`pos_live_${shopId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bills', filter },
      () => debounce('bills', () => invalidate([...BILL_QUERY_KEYS, ...AUDIT_QUERY_KEYS])))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs', filter },
      () => debounce('audit', () => invalidate(AUDIT_QUERY_KEYS)))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter },
      () => debounce('expenses', () => {
        invalidate(['dashboard-stats', 'dashboard-sales-stats', 'stats']);
        window.dispatchEvent(new CustomEvent(EXPENSES_CHANGED_EVENT));
      }))
    .subscribe();

  // Staff devices can't read the full bills table after the cost-protection update; the
  // database also writes a cost-free "bill changed" signal to pos_events (own channel, so
  // a missing table can't affect the listeners above).
  eventsChannel = supabase
    .channel(`pos_events_live_${shopId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pos_events', filter },
      (payload) => {
        if (payload?.new?.kind === 'bill') debounce('bills', () => invalidate([...BILL_QUERY_KEYS, ...AUDIT_QUERY_KEYS]));
      })
    .subscribe();
}

export function stopLiveRefresh() {
  Object.values(timers).forEach(clearTimeout);
  timers = {};
  if (channel) {
    try { supabase.removeChannel(channel); } catch (e) { /* ignore */ }
    channel = null;
  }
  if (eventsChannel) {
    try { supabase.removeChannel(eventsChannel); } catch (e) { /* ignore */ }
    eventsChannel = null;
  }
}
