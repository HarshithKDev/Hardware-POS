// Each device keeps ONE live subscription for stock and sales changes (the shop's pos_events
// signal), instead of separate ones on product_master / inventory_batches (for every shop)
// and bills, which the database had to check every sale against.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const subs = [];
const channelObj = {
  on: vi.fn((type, opts, cb) => { subs.push({ type, opts, cb }); return channelObj; }),
  subscribe: vi.fn(() => channelObj),
};
vi.mock('../supabaseClient', () => ({
  supabase: { channel: vi.fn(() => channelObj), removeChannel: vi.fn() },
}));
vi.mock('../services/db', () => ({
  deleteInventoryItemByBarcode: vi.fn(), getSyncStatus: vi.fn(), setSyncStatus: vi.fn(),
  getLocalInventoryCount: vi.fn(), saveInventoryBatch: vi.fn(), deleteOrphanedInventory: vi.fn(),
  getOfflineQueue: vi.fn(async () => []),
}));

import { startRealtimeSync, stopRealtimeSync } from '../services/sync';
import { POS_EVENT } from '../services/posEvents';

describe('live subscriptions', () => {
  beforeEach(() => { subs.length = 0; localStorage.setItem('shop_id', 'shop-1'); });
  afterEach(() => { stopRealtimeSync(); localStorage.clear(); });

  it('one subscription, filtered to this shop, that every screen shares', () => {
    startRealtimeSync('owner');
    expect(subs).toHaveLength(1);
    expect(subs[0].opts).toMatchObject({ table: 'pos_events', event: 'INSERT', filter: 'shop_id=eq.shop-1' });

    const seen = vi.fn();
    window.addEventListener(POS_EVENT, seen);
    subs[0].cb({ new: { kind: 'bill', op: 'INSERT', ref: 'b1' } });
    window.removeEventListener(POS_EVENT, seen);
    expect(seen.mock.calls[0][0].detail).toMatchObject({ kind: 'bill' });
  });
});

describe('signed-out copies of the app stay quiet', () => {
  beforeEach(() => { subs.length = 0; localStorage.clear(); localStorage.setItem('shop_id', 'shop-1'); });
  afterEach(async () => {
    const { supabase } = await import('../supabaseClient');
    delete supabase.auth;
    stopRealtimeSync();
    localStorage.clear();
  });

  it('no live subscription and no sync without a signed-in login on the device', async () => {
    const { supabase } = await import('../supabaseClient');
    supabase.auth = { storageKey: 'sb-test-auth-token' }; // real client, nobody signed in
    supabase.from = vi.fn();
    startRealtimeSync('owner');
    expect(subs).toHaveLength(0);
    const { syncInventoryToLocal, flushOfflineQueue } = await import('../services/sync');
    await syncInventoryToLocal('owner');
    await flushOfflineQueue('owner');
    expect(supabase.from).not.toHaveBeenCalled();

    // signed in: subscribes as usual
    localStorage.setItem('sb-test-auth-token', JSON.stringify({ refresh_token: 'r', user: { email: 'o@x.com' } }));
    startRealtimeSync('owner');
    expect(subs).toHaveLength(1);
  });
});
