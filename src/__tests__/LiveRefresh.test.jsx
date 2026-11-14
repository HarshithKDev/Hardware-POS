import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const handlers = {};
const channelObj = {
  on: vi.fn((type, opts, cb) => { handlers[opts.table] = { opts, cb }; return channelObj; }),
  subscribe: vi.fn(() => channelObj),
};
vi.mock('../supabaseClient', () => ({
  supabase: { channel: vi.fn(() => channelObj), removeChannel: vi.fn() },
}));

import { startLiveRefresh, stopLiveRefresh, EXPENSES_CHANGED_EVENT, INVENTORY_REFRESH_MS } from '../services/liveRefresh';
import { POS_EVENT } from '../services/posEvents';

// A sale/return/dispatch arrives as the shop's "bill changed" signal
const billChanged = () => window.dispatchEvent(new CustomEvent(POS_EVENT, { detail: { kind: 'bill', op: 'UPDATE' } }));

describe('Live refresh of sales / dashboard / expenses across devices', () => {
  let queryClient;
  beforeEach(() => {
    vi.useFakeTimers();
    queryClient = { invalidateQueries: vi.fn() };
    startLiveRefresh(queryClient, 'shop-1');
  });
  afterEach(() => {
    stopLiveRefresh();
    vi.useRealTimers();
  });

  it('listens only to this shop, and not to the bills table separately', () => {
    expect(handlers.audit_logs.opts.filter).toBe('shop_id=eq.shop-1');
    expect(handlers.expenses.opts.filter).toBe('shop_id=eq.shop-1');
    expect(handlers.bills).toBeUndefined();
  });

  it('ignores stock-only signals (those refresh the catalog, not the sales screens)', () => {
    window.dispatchEvent(new CustomEvent(POS_EVENT, { detail: { kind: 'batch', op: 'UPDATE' } }));
    vi.advanceTimersByTime(70000);
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
  });

  it('a new bill refreshes the ledger, dashboard and showroom once (debounced)', () => {
    billChanged(); billChanged(); billChanged();
    expect(queryClient.invalidateQueries).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1300);
    const keys = queryClient.invalidateQueries.mock.calls.map(c => c[0].queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(['bills', 'dashboard-sales-stats', 'showroom-sales', 'unifiedAuditLogs']));
    expect(keys.filter(k => k === 'bills')).toHaveLength(1);
  });

  it('stock figures (capital, low stock, dead stock) refresh at most once a minute after sales', () => {
    const stockRefreshes = () => queryClient.invalidateQueries.mock.calls.filter(c => c[0].queryKey[0] === 'dashboard-inventory-stats').length;
    billChanged();
    vi.advanceTimersByTime(1300);
    expect(stockRefreshes()).toBe(1); // first sale: soon

    // a busy minute of sales: no reload for each one, one at the end of the minute
    for (let i = 0; i < 10; i++) { billChanged(); vi.advanceTimersByTime(5000); }
    expect(stockRefreshes()).toBe(1);
    vi.advanceTimersByTime(INVENTORY_REFRESH_MS);
    expect(stockRefreshes()).toBe(2);

    // sales figures still refresh after every sale
    const salesRefreshes = queryClient.invalidateQueries.mock.calls.filter(c => c[0].queryKey[0] === 'dashboard-sales-stats').length;
    expect(salesRefreshes).toBeGreaterThanOrEqual(10);
  });

  it('an expense change tells the Expenses screen to reload', () => {
    const listener = vi.fn();
    window.addEventListener(EXPENSES_CHANGED_EVENT, listener);
    handlers.expenses.cb({});
    vi.advanceTimersByTime(1300);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(EXPENSES_CHANGED_EVENT, listener);
  });
});
