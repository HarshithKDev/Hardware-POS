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
      last_sync: lastSyncTime
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
      last_sync: '2026-10-21T18:00:00.000Z'
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
});
