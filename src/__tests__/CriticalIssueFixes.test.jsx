import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory fakes
// ---------------------------------------------------------------------------
let handler = () => ({ data: null, error: null });
const rpcCalls = [];
let rpcImpl = async (name) => (String(name).startsWith('pos_') ? { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } } : { data: { bill_id: 'bill-1' }, error: null });

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
import { beginCriticalWork, isCriticalWorkInProgress } from '../services/busyGuard';

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
  rpcImpl = async (name) => (String(name).startsWith('pos_') ? { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } } : { data: { bill_id: 'bill-1' }, error: null });
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
    let v = 1;
    // every read sees a value changed by another terminal, so every guarded write misses
    handler = (s) => (s.op === 'select' ? { data: { a: v++ }, error: null } : { error: null, count: 0 });
    await expect(casUpdateRow({
      table: 't', match: { id: 1 }, columns: ['a'], maxAttempts: 2,
      compute: (c) => ({ update: { a: c.a + 1 } }),
    })).rejects.toThrow(/another terminal/i);
  });

  it('reports a permission problem when the database silently refuses the update', async () => {
    // row never changes but the write matches nothing -> row-level permissions refused it
    handler = (s) => (s.op === 'select' ? { data: { a: 1 }, error: null } : { error: null, count: 0 });
    await expect(casUpdateRow({
      table: 't', match: { id: 1 }, columns: ['a'],
      compute: (c) => ({ update: { a: c.a + 1 } }),
    })).rejects.toThrow(/not allowed to change stock/i);
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

// ---------------------------------------------------------------------------
// High-severity follow-ups
// ---------------------------------------------------------------------------
describe('B4: offline receipts with warehouse disabled are routed to store after sync', () => {
  it('moves the synced quantity from warehouse to store', async () => {
    queue.set(9, queuedSale(9, {
      p_action: 'RECEIVE', p_location: 'Store',
      p_items: [{ barcode: '2002', batch_id: 'BT', actual_quantity: 4 }],
    }));
    const writes = [];
    handler = (s) => {
      if (s.table === 'inventory_batches' && s.op === 'select') return { data: { batch_id: 'BT', stock_warehouse: 4, stock_store: 1 }, error: null };
      if (s.table === 'product_master' && s.op === 'select' && s.single) return { data: { stock_warehouse: 4, stock_store: 1 }, error: null };
      if (s.op === 'update') { writes.push(s); return { error: null, count: 1 }; }
      return { data: [], error: null, count: 1 };
    };
    await flushOfflineQueue('worker');
    const batchWrite = writes.find((w) => w.table === 'inventory_batches');
    expect(batchWrite.payload).toEqual({ stock_warehouse: 0, stock_store: 5 });
    // product totals are recalculated from batches by the database, not written by the app
    expect(writes.find((w) => w.table === 'product_master')).toBeUndefined();
  });

  it('does not route normal warehouse receipts', async () => {
    queue.set(10, queuedSale(10, { p_action: 'RECEIVE', p_location: 'Warehouse-Inbound' }));
    const writes = [];
    handler = (s) => { if (s.op === 'update' && s.table !== 'bills') writes.push(s); return { data: [], error: null, count: 1 }; };
    await flushOfflineQueue('worker');
    expect(writes).toHaveLength(0);
  });
});

describe('D2: app update waits for critical work', () => {
  it('reports busy while a flush is running and idle afterwards', async () => {
    queue.set(11, queuedSale(11));
    let sawBusy = false;
    rpcImpl = async () => { sawBusy = isCriticalWorkInProgress(); return { data: { bill_id: 'b' }, error: null }; };
    await flushOfflineQueue('worker');
    expect(sawBusy).toBe(true);
    expect(isCriticalWorkInProgress()).toBe(false);
  });

  it('end function is idempotent', () => {
    const end = beginCriticalWork();
    end(); end();
    expect(isCriticalWorkInProgress()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Medium-severity helpers
// ---------------------------------------------------------------------------
import { localToUtcIso, getPerformedBy } from '../utils';

describe('E1: local day boundaries are converted to UTC for queries', () => {
  it('converts local midnight to the matching UTC instant', () => {
    expect(localToUtcIso('2026-11-10T00:00:00')).toBe(new Date(2026, 10, 10, 0, 0, 0).toISOString());
    expect(localToUtcIso('2026-11-10T23:59:59.999')).toBe(new Date(2026, 10, 10, 23, 59, 59, 999).toISOString());
  });
  it('leaves unparsable input unchanged', () => {
    expect(localToUtcIso('not-a-date')).toBe('not-a-date');
  });
});

describe('C8: audit logs record the real user', () => {
  it('uses the staff name for staff sessions even if an owner name is cached', () => {
    localStorage.setItem('owner_name', 'Harsh');
    sessionStorage.setItem('posUserRole', 'Raju');
    expect(getPerformedBy()).toBe('Raju');
    sessionStorage.clear();
  });
  it('uses the owner name for the owner', () => {
    localStorage.setItem('owner_name', 'Harsh');
    localStorage.setItem('posUserRole', 'owner');
    expect(getPerformedBy()).toBe('Harsh');
  });
});

// ---------------------------------------------------------------------------
// Scrap (per batch, totals only)
// ---------------------------------------------------------------------------
import { scrapBatchStock } from '../services/atomicStock';

describe('Scrap stock from a batch', () => {
  it('fallback: removes the quantity from store stock (product totals left to the database)', async () => {
    const writes = [];
    handler = (s) => {
      if (s.op === 'select' && s.table === 'inventory_batches') return { data: { stock_store: 50, stock_warehouse: 20 }, error: null };
      if (s.op === 'select' && s.table === 'product_master') return { data: { stock_store: 50, stock_warehouse: 20 }, error: null };
      writes.push(s);
      return { error: null, count: 1 };
    };
    const res = await scrapBatchStock({ batchId: 'B', barcode: '2001', shopId: 'S', qty: 10, location: 'store' });
    expect(res).toEqual({ fromStore: 10, fromWarehouse: 0, audited: false });
    expect(writes.find(w => w.table === 'inventory_batches').payload).toEqual({ stock_store: 40, stock_warehouse: 20 });
    expect(writes.find(w => w.table === 'product_master')).toBeUndefined();
  });

  it('refuses to scrap more than is available', async () => {
    handler = (s) => (s.op === 'select' ? { data: { stock_store: 5, stock_warehouse: 0 }, error: null } : { error: null, count: 1 });
    await expect(scrapBatchStock({ batchId: 'B', barcode: '2001', qty: 8, location: 'store' })).rejects.toThrow(/Only 5 available/);
  });

  it('with the warehouse disabled, takes the remainder from warehouse stock', async () => {
    const writes = [];
    handler = (s) => {
      if (s.op === 'select') return { data: { stock_store: 3, stock_warehouse: 10 }, error: null };
      writes.push(s);
      return { error: null, count: 1 };
    };
    const res = await scrapBatchStock({ batchId: 'B', barcode: '2001', qty: 5, location: 'store', allowOtherLocation: true });
    expect(res).toEqual({ fromStore: 3, fromWarehouse: 2, audited: false });
    expect(writes[0].payload).toEqual({ stock_store: 0, stock_warehouse: 8 });
  });
});

import { priceInputValue } from '../utils';
describe('Price boxes start empty instead of 0', () => {
  it('pre-fills real prices but not zeros', () => {
    expect(priceInputValue(0)).toBe('');
    expect(priceInputValue(null, undefined)).toBe('');
    expect(priceInputValue('0.00')).toBe('');
    expect(priceInputValue(0, 45)).toBe('45');
    expect(priceInputValue(120.5)).toBe('120.5');
  });
});

// ---------------------------------------------------------------------------
// Screw boxes: open 1 box for loose sale (removed from stock, not a sale)
// ---------------------------------------------------------------------------
import { openScrewBox, pickBoxBatch, storeBoxCount } from '../services/screwBox';
import { isScrewBox } from '../constants';

describe('Screw boxes', () => {
  const box = {
    barcode: '1400', name: 'Screw Box 8x1', unit: 'BOX',
    batches: [
      { batch_id: 'B2', batch_number: 2, stock_store: 4, stock_warehouse: 0 },
      { batch_id: 'B1', batch_number: 1, stock_store: 0, stock_warehouse: 3 },
      { batch_id: 'B3', batch_number: 3, stock_store: 1, stock_warehouse: 0, is_active: false },
    ],
  };

  it('is identified by the BOX unit', () => {
    expect(isScrewBox(box)).toBe(true);
    expect(isScrewBox({ unit: 'PCS' })).toBe(false);
  });

  it('counts store boxes only (warehouse too when the warehouse is disabled)', () => {
    expect(storeBoxCount(box, false)).toBe(4);
    expect(storeBoxCount(box, true)).toBe(7);
  });

  it('opens from the oldest batch that has a box in the store', () => {
    expect(pickBoxBatch(box, false).batch_id).toBe('B2');
    expect(pickBoxBatch(box, true).batch_id).toBe('B1');
  });

  it('removes exactly 1 box from store stock and records it in the audit log', async () => {
    const writes = [];
    handler = (s) => {
      if (s.op === 'select') return { data: { stock_store: 4, stock_warehouse: 0 }, error: null };
      writes.push(s);
      return { error: null, count: 1 };
    };
    await openScrewBox({ item: box, shopId: 'S', isWarehouseDisabled: false });
    expect(writes.find(w => w.table === 'inventory_batches').payload).toEqual({ stock_store: 3, stock_warehouse: 0 });
    const audit = writes.find(w => w.table === 'audit_logs' && w.op === 'insert');
    expect(audit.payload[0]).toMatchObject({ action_type: 'BOX_OPENED', barcode: '1400' });
  });

  it('refuses when no box is left in the store', async () => {
    const empty = { ...box, batches: [{ batch_id: 'B1', batch_number: 1, stock_store: 0, stock_warehouse: 5 }] };
    await expect(openScrewBox({ item: empty, shopId: 'S', isWarehouseDisabled: false })).rejects.toThrow(/No Screw Box 8x1 left in store/);
  });
});

import { formatINR } from '../utils';
describe('Indian number formatting for prices', () => {
  it('uses lakh/crore grouping', () => {
    expect(formatINR(100000)).toBe('1,00,000.00');
    expect(formatINR(30000)).toBe('30,000.00');
    expect(formatINR(10000, 0)).toBe('10,000');
    expect(formatINR(12345678.9)).toBe('1,23,45,678.90');
    expect(formatINR(999.5)).toBe('999.50');
    expect(formatINR('21100')).toBe('21,100.00');
    expect(formatINR(undefined)).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// After the database update: one-call functions
// ---------------------------------------------------------------------------
describe('One-call database functions (after the SQL update)', () => {
  it('scrap uses pos_remove_stock and does not write stock itself', async () => {
    const writes = [];
    handler = (s) => { writes.push(s); return { data: [], error: null, count: 1 }; };
    rpcImpl = async (name, args) => (name === 'pos_remove_stock'
      ? { data: { from_store: args.p_qty, from_warehouse: 0 }, error: null }
      : { data: null, error: null });
    const res = await scrapBatchStock({ batchId: 'B', barcode: '2001', shopId: 'S', qty: 10, location: 'store', actionType: 'SCRAP', note: 'offcuts', performedBy: 'Owner' });
    expect(res).toEqual({ fromStore: 10, fromWarehouse: 0, audited: true });
    expect(rpcCalls.at(-1)).toMatchObject({ name: 'pos_remove_stock', payload: { p_batch_id: 'B', p_qty: 10, p_action_type: 'SCRAP', p_note: 'offcuts' } });
    expect(writes.filter(w => w.op === 'update')).toHaveLength(0);
  });

  it('a database refusal (e.g. not enough stock) is shown to the user', async () => {
    rpcImpl = async () => ({ data: null, error: { code: 'P0001', message: 'Only 5 available in this batch; cannot remove 8.' } });
    await expect(scrapBatchStock({ batchId: 'B', barcode: '2001', qty: 8, location: 'store' })).rejects.toThrow(/Only 5 available/);
  });

  it('an interrupted offline sale with a reference is resent safely (database de-duplicates)', async () => {
    queue.set(21, queuedSale(21, { status: 'submitting', client_ref: 'ref-21' }));
    rpcImpl = async (name) => (name === 'pos_process_sale' ? { data: { bill_id: 'bill-21', duplicate: true }, error: null } : { data: null, error: null });
    await flushOfflineQueue('worker');
    expect(rpcCalls.find(c => c.name === 'pos_process_sale').payload).toMatchObject({ p_client_ref: 'ref-21', p_action: 'SALE', p_payment_method: 'CASH', p_cash_amount: 100 });
    expect(queue.has(21)).toBe(false);
  });

  it('an interrupted sale is NOT resent when the database has not been updated yet', async () => {
    queue.set(22, queuedSale(22, { status: 'submitting', client_ref: 'ref-22' }));
    await flushOfflineQueue('worker'); // default rpcImpl: pos_* functions missing
    expect(rpcCalls.filter(c => c.name.startsWith('process_pos'))).toHaveLength(0);
    expect(queue.get(22).status).toBe('failed');
  });
});

import { billLabel } from '../utils';
describe('Bill numbers', () => {
  it('shows the sequential number when the bill has one, else the short id', () => {
    expect(billLabel({ id: '71de4b03-aaaa-bbbb', bill_no: 1234 })).toBe('1234');
    expect(billLabel({ id: '71de4b03-aaaa-bbbb', bill_no: null })).toBe('71de4b03');
    expect(billLabel({ id: '71de4b03-aaaa-bbbb' })).toBe('71de4b03');
  });
});
