import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------
let handler = () => ({ data: null, error: null });
const rpcCalls = [];
let rpcImpl = async () => ({ data: { bill_id: 'bill-1' }, error: null });

function makeBuilder(table) {
  const state = { table, op: 'select', filters: [], payload: null, opts: null, cols: null };
  const b = {
    select(cols) { if (state.op === 'select') state.cols = cols; return b; },
    update(p, o) { state.op = 'update'; state.payload = p; state.opts = o; return b; },
    insert(p) { state.op = 'insert'; state.payload = p; return b; },
    delete() { state.op = 'delete'; return b; },
    eq(c, v) { state.filters.push(['eq', c, v]); return b; },
    is(c, v) { state.filters.push(['is', c, v]); return b; },
    in() { return b; }, gt() { return b; }, range() { return b; },
    limit() { return b; }, order() { return b; }, abortSignal() { return b; },
    maybeSingle() { state.single = true; return b; },
    then(res, rej) { return Promise.resolve().then(() => handler(state)).then(res, rej); },
  };
  return b;
}

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn((t) => makeBuilder(t)),
    rpc: vi.fn((name, payload) => { rpcCalls.push({ name, payload }); return rpcImpl(name, payload); }),
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

const queue = new Map();
vi.mock('../services/db', () => ({
  saveInventoryBatch: vi.fn().mockResolvedValue(),
  getOfflineQueue: vi.fn(async () => [...queue.values()].map((t) => ({ ...t }))),
  deleteOfflineTransaction: vi.fn(async (id) => { queue.delete(id); }),
  setSyncStatus: vi.fn().mockResolvedValue(),
  getSyncStatus: vi.fn().mockResolvedValue({ last_sync: new Date().toISOString(), synced_with_cost: true }),
  markTransactionFailed: vi.fn(async (id, msg) => {
    const t = queue.get(id); if (t) queue.set(id, { ...t, status: 'failed', error_message: msg });
  }),
  markTransactionSubmitting: vi.fn(async (id) => {
    const t = queue.get(id);
    if (!t || (t.status && t.status !== 'pending')) return false;
    queue.set(id, { ...t, status: 'submitting' });
    return true;
  }),
  deleteOrphanedInventory: vi.fn().mockResolvedValue(),
  getLocalInventoryCount: vi.fn().mockResolvedValue(5),
  deleteInventoryItemByBarcode: vi.fn().mockResolvedValue(),
}));

import { casUpdateRow } from '../services/atomicStock';
import { finalizeBillMetadata, flushPendingBillPatches, getPendingBillPatchCount } from '../services/billFinalize';
import { flushOfflineQueue } from '../services/sync';
import { isRoleConsistentWithEmail, isNetworkishError } from '../services/roleGuard';

const queuedSale = (id, extra = {}) => ({
  id, status: 'pending', shop_id: 'shop-abc',
  p_action: 'SALE', p_location: 'Store', p_cashier_name: 'Raju',
  p_items: [{ barcode: '1001', actual_quantity: 1 }],
  p_payment_method: 'CASH', p_cash_amount: 100, p_upi_amount: 0,
  ...extra,
});

beforeEach(() => {
  vi.useRealTimers();
  queue.clear();
  rpcCalls.length = 0;
  rpcImpl = async () => ({ data: { bill_id: 'bill-1' }, error: null });
  handler = () => ({ data: [], error: null, count: 1 });
  localStorage.clear();
  localStorage.setItem('shop_id', 'shop-abc');
});

// ---------------------------------------------------------------------------
// A1 — offline queue must never post the same sale twice
// ---------------------------------------------------------------------------
describe('A1: offline queue flush', () => {
  it('concurrent flush triggers send each queued sale exactly once', async () => {
    queue.set(1, queuedSale(1));
    queue.set(2, queuedSale(2));
    rpcImpl = async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { data: { bill_id: `bill-${rpcCalls.length}` }, error: null };
    };

    // startup + interval + focus + online all at once
    await Promise.all([
      flushOfflineQueue('worker'), flushOfflineQueue('worker'),
      flushOfflineQueue('worker'), flushOfflineQueue('worker'),
    ]);

    const saleCalls = rpcCalls.filter((c) => c.name.startsWith('process_pos_transaction'));
    expect(saleCalls).toHaveLength(2);
    expect(queue.size).toBe(0);
  });

  it('does not auto-resend a sale that was interrupted mid-send; moves it to Failed for review', async () => {
    queue.set(7, queuedSale(7, { status: 'submitting' }));
    await flushOfflineQueue('worker');

    expect(rpcCalls).toHaveLength(0);
    expect(queue.get(7).status).toBe('failed');
    expect(queue.get(7).error_message).toMatch(/may already be recorded/i);
  });

  it('removes the sale from the queue even if saving payment details fails afterwards', async () => {
    queue.set(3, queuedSale(3));
    handler = (s) => {
      if (s.table === 'bills' && s.op === 'update') return { data: null, error: { message: 'boom' } };
      return { data: [], error: null, count: 1 };
    };
    await flushOfflineQueue('worker');

    expect(rpcCalls.filter((c) => c.name.startsWith('process_pos'))).toHaveLength(1);
    expect(queue.has(3)).toBe(false);          // never re-sent
    expect(getPendingBillPatchCount()).toBe(1); // payment details parked for retry
  }, 10000);

  it('server rejection marks the sale failed (not deleted, not retried automatically)', async () => {
    queue.set(4, queuedSale(4));
    rpcImpl = async () => ({ data: null, error: { message: 'chk_stock_store_nonnegative' } });
    await flushOfflineQueue('worker');
    await flushOfflineQueue('worker');

    expect(rpcCalls).toHaveLength(1);
    expect(queue.get(4).status).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// A2 — bill payment details are retried / parked instead of silently lost
// ---------------------------------------------------------------------------
describe('A2: finalizeBillMetadata', () => {
  it('succeeds on first try without parking anything', async () => {
    const res = await finalizeBillMetadata({ billId: 'b1', updatePayload: { payment_method: 'CASH' } });
    expect(res).toEqual({ ok: true, queued: false });
    expect(getPendingBillPatchCount()).toBe(0);
  });

  it('retries a transient failure and then succeeds', async () => {
    let calls = 0;
    handler = (s) => {
      if (s.table === 'bills') { calls++; return calls === 1 ? { error: { message: 'Failed to fetch' } } : { error: null }; }
      return { data: [], error: null };
    };
    const res = await finalizeBillMetadata({ billId: 'b2', updatePayload: { payment_method: 'UPI' } });
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('parks the patch after repeated failure and never throws', async () => {
    handler = () => ({ error: { message: 'down' } });
    const res = await finalizeBillMetadata({ billId: 'b3', updatePayload: { payment_method: 'CASH' } });
    expect(res.ok).toBe(false);
    expect(res.queued).toBe(true);
    expect(getPendingBillPatchCount()).toBe(1);

    // Connection back: background flush applies it and clears the list
    handler = () => ({ data: [], error: null });
    await flushPendingBillPatches();
    expect(getPendingBillPatchCount()).toBe(0);
  }, 10000);

  it('does not insert a second Screws line when one already exists', async () => {
    const inserts = [];
    handler = (s) => {
      if (s.table === 'bill_items' && s.op === 'select') return { data: [{ id: 'x' }], error: null };
      if (s.op === 'insert') inserts.push(s.payload);
      return { data: [], error: null };
    };
    await finalizeBillMetadata({ billId: 'b4', updatePayload: {}, screwRow: { bill_id: 'b4', barcode: 'SCREWS' } });
    expect(inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// B1 — compare-and-swap stock updates
// ---------------------------------------------------------------------------
describe('B1: casUpdateRow', () => {
  it('guards the write with the values it read and applies the increment', async () => {
    const writes = [];
    handler = (s) => {
      if (s.op === 'select') return { data: { stock_store: 10 }, error: null };
      writes.push(s);
      return { error: null, count: 1 };
    };
    const res = await casUpdateRow({
      table: 'inventory_batches', match: { batch_id: 'B', shop_id: 'S' }, columns: ['stock_store'],
      compute: (cur) => ({ update: { stock_store: cur.stock_store + 3 } }),
    });
    expect(res.applied).toBe(true);
    expect(writes[0].payload).toEqual({ stock_store: 13 });
    expect(writes[0].opts).toEqual({ count: 'exact' });
    expect(writes[0].filters).toContainEqual(['eq', 'stock_store', 10]);
    expect(writes[0].filters).toContainEqual(['eq', 'batch_id', 'B']);
  });

  it('re-reads and recomputes when another terminal changed the row in between', async () => {
    let stock = 10;
    let first = true;
    handler = (s) => {
      if (s.op === 'select') return { data: { stock_store: stock }, error: null };
      const guard = s.filters.find((f) => f[1] === 'stock_store')[2];
      if (first) { first = false; stock = 7; } // concurrent sale of 3 lands before our write
      if (guard !== stock) return { error: null, count: 0 };
      stock = s.payload.stock_store;
      return { error: null, count: 1 };
    };
    await casUpdateRow({
      table: 'inventory_batches', match: { batch_id: 'B' }, columns: ['stock_store'],
      compute: (cur) => ({ update: { stock_store: cur.stock_store + 2 } }),
    });
    expect(stock).toBe(9); // 10 - 3 (other sale) + 2 (our return) — nothing lost
  });

  it('returns notFound / skipped without writing', async () => {
    handler = () => ({ data: null, error: null });
    expect((await casUpdateRow({ table: 't', match: { id: 1 }, columns: ['a'], compute: () => ({ update: {} }) })).notFound).toBe(true);

    handler = (s) => (s.op === 'select' ? { data: { a: 0 }, error: null } : { error: null, count: 1 });
    expect((await casUpdateRow({ table: 't', match: { id: 1 }, columns: ['a'], compute: () => null })).skipped).toBe(true);
  });

  it('gives up with a clear error under constant contention', async () => {
    handler = (s) => (s.op === 'select' ? { data: { a: 1 }, error: null } : { error: null, count: 0 });
    await expect(casUpdateRow({
      table: 't', match: { id: 1 }, columns: ['a'], maxAttempts: 2,
      compute: (c) => ({ update: { a: c.a + 1 } }),
    })).rejects.toThrow(/another terminal/i);
  });
});

// ---------------------------------------------------------------------------
// C1/C2 — stored role must match the signed-in account
// ---------------------------------------------------------------------------
describe('C1/C2: isRoleConsistentWithEmail', () => {
  const shopId = '3f2a9b1c-1111-2222-3333-444455556666';

  it('accepts the real owner (case-insensitive)', () => {
    expect(isRoleConsistentWithEmail('owner', 'Owner@Shop.com', { adminEmail: 'owner@shop.com', shopId })).toBe(true);
  });

  it('rejects a staff session claiming to be owner', () => {
    expect(isRoleConsistentWithEmail('owner', 'raju.3f2a9b1c@hardwarepos.com', { adminEmail: 'owner@shop.com', shopId })).toBe(false);
  });

  it('rejects owner when admin email is unknown', () => {
    expect(isRoleConsistentWithEmail('owner', 'owner@shop.com', { adminEmail: null, shopId })).toBe(false);
  });

  it('accepts staff with scoped and legacy emails', () => {
    expect(isRoleConsistentWithEmail('Raju Kumar', 'rajukumar.3f2a9b1c@hardwarepos.com', { shopId })).toBe(true);
    expect(isRoleConsistentWithEmail('Raju Kumar', 'rajukumar@hardwarepos.com', { shopId })).toBe(true);
  });

  it('rejects staff impersonating another staff member', () => {
    expect(isRoleConsistentWithEmail('Suresh', 'raju.3f2a9b1c@hardwarepos.com', { shopId })).toBe(false);
  });

  it('classifies network errors', () => {
    expect(isNetworkishError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isNetworkishError({ message: 'AbortError: signal timed out' })).toBe(true);
    expect(isNetworkishError({ message: 'permission denied for table shop_settings' })).toBe(false);
  });
});
