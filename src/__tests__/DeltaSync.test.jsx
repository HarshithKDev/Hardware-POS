import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncInventoryToLocal } from '../services/sync';
import * as db from '../services/db';
import { supabase } from '../supabaseClient';

vi.mock('../services/db', () => ({
  saveInventoryBatch: vi.fn().mockResolvedValue(),
  getOfflineQueue: vi.fn().mockResolvedValue([]),
  deleteOfflineTransaction: vi.fn().mockResolvedValue(),
  setSyncStatus: vi.fn().mockResolvedValue(),
  getSyncStatus: vi.fn(),
  markTransactionFailed: vi.fn().mockResolvedValue(),
  deleteOrphanedInventory: vi.fn().mockResolvedValue(),
  getLocalInventoryCount: vi.fn(),
  deleteInventoryItemByBarcode: vi.fn().mockResolvedValue(),
}));

vi.mock('../supabaseClient', () => ({
  supabase: {
    from: vi.fn()
  }
}));

const createChainableQuery = (data = [], error = null) => {
  const query = {
    data,
    error,
    then(resolve, reject) {
      return Promise.resolve({ data, error }).then(resolve, reject);
    }
  };
  query.select = vi.fn().mockReturnValue(query);
  query.eq = vi.fn().mockReturnValue(query);
  query.in = vi.fn().mockReturnValue(query);
  query.gt = vi.fn().mockReturnValue(query);
  query.range = vi.fn().mockReturnValue(query);
  query.limit = vi.fn().mockReturnValue(query);
  return query;
};

describe('Delta / Incremental Sync System', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('shop_id', 'test-shop-123');
  });

  it('runs FULL sync when local inventory is empty or last_sync is missing', async () => {
    vi.mocked(db.getSyncStatus).mockResolvedValue(null);
    vi.mocked(db.getLocalInventoryCount).mockResolvedValue(0);

    const prodQuery = createChainableQuery([{ barcode: '1001', name: 'Item 1' }]);
    const batchQuery = createChainableQuery([]);

    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'product_master_public') return prodQuery;
      if (table === 'inventory_batches_public') return batchQuery;
      return createChainableQuery();
    });

    await syncInventoryToLocal('worker');

    // Should call full sync logic and cleanup orphaned items
    expect(db.deleteOrphanedInventory).toHaveBeenCalled();
    expect(db.saveInventoryBatch).toHaveBeenCalled();
    expect(db.setSyncStatus).toHaveBeenCalledWith(
      expect.stringContaining('inventory_sync'),
      expect.objectContaining({ mode: 'full' })
    );
  });

  it('runs DELTA sync when last_sync exists and local items > 0', async () => {
    const lastSyncTime = '2026-10-21T18:00:00.000Z';
    vi.mocked(db.getSyncStatus).mockResolvedValue({
      key: 'inventory_sync_test-shop-123_worker',
      status: 'idle',
      last_sync: lastSyncTime,
      last_full_sync: new Date().toISOString() // recent full sync → delta allowed
    });
    vi.mocked(db.getLocalInventoryCount).mockResolvedValue(150);

    const prodQuery = createChainableQuery([{ barcode: '1002', name: 'Updated Item 2', is_active: true }]);
    const batchQuery = createChainableQuery([{ barcode: '1002', batch_number: 1, stock_store: 10 }]);

    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'product_master_public') return prodQuery;
      if (table === 'inventory_batches_public') return batchQuery;
      return createChainableQuery();
    });

    await syncInventoryToLocal('worker');

    // Delta sync MUST query by updated_at
    expect(prodQuery.gt).toHaveBeenCalledWith('updated_at', expect.any(String));

    // Delta sync MUST NOT delete orphaned inventory
    expect(db.deleteOrphanedInventory).not.toHaveBeenCalled();

    // Delta sync saves only the modified products
    expect(db.saveInventoryBatch).toHaveBeenCalledWith([
      expect.objectContaining({ barcode: '1002' })
    ]);

    expect(db.setSyncStatus).toHaveBeenCalledWith(
      expect.stringContaining('inventory_sync'),
      expect.objectContaining({ mode: 'delta' })
    );
  });

  it('forces FULL sync when options.forceFull is true', async () => {
    vi.mocked(db.getSyncStatus).mockResolvedValue({
      key: 'inventory_sync_test-shop-123_worker',
      status: 'idle',
      last_sync: '2026-10-21T18:00:00.000Z'
    });
    vi.mocked(db.getLocalInventoryCount).mockResolvedValue(150);

    const prodQuery = createChainableQuery([{ barcode: '1001', name: 'Item 1' }]);
    const batchQuery = createChainableQuery([]);

    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'product_master_public') return prodQuery;
      if (table === 'inventory_batches_public') return batchQuery;
      return createChainableQuery();
    });

    await syncInventoryToLocal('worker', { forceFull: true });

    expect(db.deleteOrphanedInventory).toHaveBeenCalled();
    expect(db.setSyncStatus).toHaveBeenCalledWith(
      expect.stringContaining('inventory_sync'),
      expect.objectContaining({ mode: 'full' })
    );
  });

  it('automatically falls back to FULL sync if updated_at column does not exist on remote db', async () => {
    vi.mocked(db.getSyncStatus).mockResolvedValue({
      key: 'inventory_sync_test-shop-123_worker',
      status: 'idle',
      last_sync: '2026-10-21T18:00:00.000Z',
      last_full_sync: new Date().toISOString() // recent full sync → delta attempted first
    });
    vi.mocked(db.getLocalInventoryCount).mockResolvedValue(150);

    // Initial ping works
    let callCount = 0;
    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'product_master_public') {
        callCount++;
        if (callCount === 1) {
          // ping query
          return createChainableQuery([{ barcode: '1001' }]);
        }
        if (callCount === 2) {
          // delta query fails with code 42703
          return createChainableQuery(null, { code: '42703', message: 'column updated_at does not exist' });
        }
        // fallback full sync query
        return createChainableQuery([{ barcode: '1001', name: 'Item 1' }]);
      }
      return createChainableQuery([]);
    });

    await syncInventoryToLocal('worker');

    // Should gracefully fall back to full sync and delete orphans
    expect(db.deleteOrphanedInventory).toHaveBeenCalled();
    expect(db.saveInventoryBatch).toHaveBeenCalled();
  });

  it('syncs owner catalog from full product_master & inventory_batches (preserving cost_price and purchase_cost) and backfills when synced_with_cost is false', async () => {
    vi.mocked(db.getSyncStatus).mockResolvedValue({
      key: 'inventory_sync_test-shop-123_owner',
      status: 'idle',
      last_sync: '2026-10-21T18:00:00.000Z',
      // Missing synced_with_cost -> previously synced from _public view
    });
    vi.mocked(db.getLocalInventoryCount).mockResolvedValue(150);

    const pingQuery = createChainableQuery([{ barcode: '1001' }]);
    const ownerProdQuery = createChainableQuery([{ barcode: '1001', name: 'Balaji Frame', cost_price: 1200 }]);
    const ownerBatchQuery = createChainableQuery([{ barcode: '1001', batch_id: 'b1', batch_number: 1, purchase_cost: 1200, msp: 2000, selling_price: 3000 }]);

    vi.mocked(supabase.from).mockImplementation((table) => {
      if (table === 'product_master_public') return pingQuery;
      if (table === 'product_master') return ownerProdQuery;
      if (table === 'inventory_batches') return ownerBatchQuery;
      return createChainableQuery([]);
    });

    await syncInventoryToLocal('owner');

    expect(supabase.from).toHaveBeenCalledWith('product_master');
    expect(supabase.from).toHaveBeenCalledWith('inventory_batches');
    expect(db.saveInventoryBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        barcode: '1001',
        cost_price: 1200,
        batches: [
          expect.objectContaining({
            purchase_cost: 1200
          })
        ]
      })
    ]);
    expect(db.setSyncStatus).toHaveBeenCalledWith(
      expect.stringContaining('inventory_sync_test-shop-123_owner'),
      expect.objectContaining({ last_mode: 'full', synced_with_cost: true })
    );
  });

  it('runs a FULL sync when the last full sync is older than 6 hours (safety net)', async () => {
    vi.mocked(db.getSyncStatus).mockResolvedValue({
      key: 'inventory_sync_test-shop-123_worker',
      status: 'idle',
      last_sync: new Date().toISOString(),
      last_full_sync: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString()
    });
    vi.mocked(db.getLocalInventoryCount).mockResolvedValue(150);
    const prodQuery = createChainableQuery([{ barcode: '1001' }]);
    vi.mocked(supabase.from).mockImplementation(() => prodQuery);

    await syncInventoryToLocal('worker');

    expect(prodQuery.gt).not.toHaveBeenCalled();      // no delta filter
    expect(prodQuery.range).toHaveBeenCalled();        // paginated full download
  });

  it('merges overlapping sync requests into one follow-up run', async () => {
    vi.mocked(db.getSyncStatus).mockResolvedValue({ last_sync: new Date().toISOString(), last_full_sync: new Date().toISOString() });
    vi.mocked(db.getLocalInventoryCount).mockResolvedValue(150);
    const prodQuery = createChainableQuery([]);
    vi.mocked(supabase.from).mockImplementation(() => prodQuery);

    await Promise.all([1, 2, 3, 4, 5].map(() => syncInventoryToLocal('worker')));

    // 1 running + 1 merged follow-up = 2 runs, each does a ping + one delta query
    const deltaCalls = prodQuery.gt.mock.calls.length;
    expect(deltaCalls).toBe(2);
  });

  it('a staff sync makes the owner\'s next sync on this device re-download cost prices', async () => {
    vi.mocked(db.getSyncStatus).mockImplementation(async (key) => (
      key.endsWith('_owner')
        ? { key, last_sync: new Date().toISOString(), last_full_sync: new Date().toISOString(), synced_with_cost: true }
        : { key, last_sync: new Date().toISOString(), last_full_sync: new Date().toISOString() }
    ));
    vi.mocked(db.getLocalInventoryCount).mockResolvedValue(150);
    const q = createChainableQuery([]);
    vi.mocked(supabase.from).mockImplementation(() => q);

    await syncInventoryToLocal('worker');

    expect(db.setSyncStatus).toHaveBeenCalledWith(
      'inventory_sync_test-shop-123_owner',
      expect.objectContaining({ synced_with_cost: false })
    );
  });
});
