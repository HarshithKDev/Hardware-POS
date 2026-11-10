import { supabase } from '../supabaseClient';
import { 
  saveInventoryBatch, 
  getOfflineQueue, 
  deleteOfflineTransaction,
  setSyncStatus,
  getSyncStatus,
  markTransactionFailed,
  deleteOrphanedInventory,
  getLocalInventoryCount,
  deleteInventoryItemByBarcode
} from './db';

const PAGE_SIZE = 500;
const BATCH_CHUNK_SIZE = 200;
const CLOCK_SKEW_BUFFER_MS = 30000; // 30-second safety margin for clock drift / query execution overlap

/**
 * Syncs inventory to the local IndexedDB using an intelligent Delta/Incremental approach.
 * If local DB is populated and last_sync is recorded, it only downloads products modified
 * since the last sync (updated_at > last_sync_time - 30s), reducing network egress by >95%.
 *
 * @param {string} userRole - 'owner' or 'worker'
 * @param {object} options - { forceFull: boolean }
 */
export const syncInventoryToLocal = async (userRole = 'worker', options = {}) => {
  const { forceFull = false } = options;
  const currentShopId = localStorage.getItem('shop_id');
  const isOwner = userRole === 'owner';
  const tableName = isOwner ? 'product_master' : 'product_master_public';
  const syncKey = `inventory_sync_${currentShopId || 'global'}_${userRole}`;

  try {
    // 1. Lightweight connectivity ping via public view so transient RLS issues don't abort before fallback
    let pingQuery = supabase.from('product_master_public').select('barcode');
    if (currentShopId) {
      pingQuery = pingQuery.eq('shop_id', currentShopId);
    }
    const { error: pingError } = await pingQuery.limit(1);
    if (pingError) throw pingError;

    // 2. Check previous sync status and local inventory count
    const prevStatus = await getSyncStatus(syncKey);
    const localCount = await getLocalInventoryCount(currentShopId);

    // Force one full sync if owner previously synced from public views (missing cost_price/purchase_cost)
    const needsCostBackfill = isOwner && prevStatus?.synced_with_cost !== true;

    // Delta sync is activated when:
    // - Not forced to perform a full sync
    // - Owner has already synced full cost fields (or worker role)
    // - A valid previous last_sync timestamp exists
    // - Local IndexedDB already contains products
    const isDelta = !forceFull && !needsCostBackfill && Boolean(prevStatus?.last_sync) && localCount > 0;

    await setSyncStatus(syncKey, { 
      status: 'syncing', 
      last_sync: prevStatus?.last_sync || null,
      mode: isDelta ? 'delta' : 'full',
      synced_with_cost: Boolean(prevStatus?.synced_with_cost)
    });

    let usedCostTables = false;
    if (isDelta) {
      try {
        const res = await performDeltaSync({
          tableName,
          userRole,
          currentShopId,
          lastSync: prevStatus.last_sync
        });
        usedCostTables = Boolean(res?.usedCostTables);
      } catch (deltaErr) {
        // Fallback to full sync if updated_at column doesn't exist yet (PostgreSQL error 42703)
        if (deltaErr.code === '42703' || deltaErr.message?.includes('updated_at')) {
          console.warn('[Sync] Database updated_at column not available yet. Falling back to full sync.');
          const res = await performFullSync({ tableName, userRole, currentShopId });
          usedCostTables = Boolean(res?.usedCostTables);
        } else {
          throw deltaErr;
        }
      }
    } else {
      const res = await performFullSync({ tableName, userRole, currentShopId });
      usedCostTables = Boolean(res?.usedCostTables);
    }

    const completedAt = new Date().toISOString();
    await setSyncStatus(syncKey, { 
      status: 'idle', 
      last_sync: completedAt,
      last_mode: isDelta ? 'delta' : 'full',
      synced_with_cost: isOwner ? (usedCostTables || Boolean(prevStatus?.synced_with_cost)) : false,
      error: null 
    });

    window.dispatchEvent(new CustomEvent('inventory_sync_complete', { 
      detail: { mode: isDelta ? 'delta' : 'full', timestamp: completedAt } 
    }));

    console.log(`[Sync] Inventory successfully synced (${isDelta ? 'Delta' : 'Full'} mode).`);
  } catch (err) {
    console.error('Failed to sync inventory to local DB:', err.message);
    const prevStatus = await getSyncStatus(syncKey);
    await setSyncStatus(syncKey, { 
      status: 'error', 
      error: err.message, 
      last_sync: prevStatus?.last_sync || null,
      synced_with_cost: Boolean(prevStatus?.synced_with_cost)
    });
  }
};

/**
 * Fetches active batches for barcodes, using full inventory_batches for owners
 * (preserving purchase_cost) and falling back to inventory_batches_public if restricted.
 */
async function fetchBatchesForBarcodes({ barcodes, currentShopId, allowCost }) {
  const allBatches = [];
  let usedCostTable = allowCost;

  for (let i = 0; i < barcodes.length; i += BATCH_CHUNK_SIZE) {
    const slice = barcodes.slice(i, i + BATCH_CHUNK_SIZE);
    const batchTable = usedCostTable ? 'inventory_batches' : 'inventory_batches_public';
    let batchQuery = supabase.from(batchTable).select('*').in('barcode', slice).eq('is_active', true);
    if (currentShopId) {
      batchQuery = batchQuery.eq('shop_id', currentShopId);
    }
    let { data: batches, error: batchError } = await batchQuery;

    if (batchTable === 'inventory_batches' && (batchError || !batches || batches.length === 0)) {
      let pubBatchQuery = supabase.from('inventory_batches_public').select('*').in('barcode', slice).eq('is_active', true);
      if (currentShopId) {
        pubBatchQuery = pubBatchQuery.eq('shop_id', currentShopId);
      }
      const pubRes = await pubBatchQuery;
      if (!pubRes.error && pubRes.data && pubRes.data.length > 0) {
        batches = pubRes.data;
        batchError = null;
        usedCostTable = false;
      }
    }

    if (batchError) throw batchError;
    if (batches) allBatches.push(...batches);
  }

  return { batches: allBatches, usedCostTable };
}

/**
 * Downloads only products modified since `lastSync` and merges them into IndexedDB.
 */
async function performDeltaSync({ tableName, userRole, currentShopId, lastSync }) {
  const lastSyncDate = new Date(lastSync);
  const effectiveTimestamp = new Date(Math.max(0, lastSyncDate.getTime() - CLOCK_SKEW_BUFFER_MS)).toISOString();

  let effectiveTable = tableName;
  let prodQuery = supabase.from(effectiveTable).select('*');
  if (currentShopId) {
    prodQuery = prodQuery.eq('shop_id', currentShopId);
  }
  // Filter by updated_at greater than the buffered previous sync timestamp
  prodQuery = prodQuery.gt('updated_at', effectiveTimestamp);

  let { data: changedProducts, error: prodError } = await prodQuery;

  // Graceful fallback to public view ONLY if raw table fails or returns empty while public view has delta changes
  if ((prodError || !changedProducts || changedProducts.length === 0) && effectiveTable === 'product_master') {
    let fallbackQuery = supabase.from('product_master_public').select('*');
    if (currentShopId) {
      fallbackQuery = fallbackQuery.eq('shop_id', currentShopId);
    }
    fallbackQuery = fallbackQuery.gt('updated_at', effectiveTimestamp);
    const fallbackRes = await fallbackQuery;
    if (!fallbackRes.error && fallbackRes.data && fallbackRes.data.length > 0) {
      effectiveTable = 'product_master_public';
      changedProducts = fallbackRes.data;
      prodError = null;
    }
  }

  if (prodError) throw prodError;

  if (!changedProducts || changedProducts.length === 0) {
    console.log('[Delta Sync] Everything is up to date (0 products modified). 0 KB transferred.');
    return { usedCostTables: effectiveTable === 'product_master' };
  }

  console.log(`[Delta Sync] Fetched ${changedProducts.length} updated product(s) since ${effectiveTimestamp}.`);

  const activeProducts = [];
  const deactivatedBarcodes = [];

  changedProducts.forEach(p => {
    if (p.is_active === false) {
      deactivatedBarcodes.push(p.barcode);
      if (userRole === 'owner') {
        // Owner preserves deactivated items locally for Recycle Bin management
        activeProducts.push(p);
      }
    } else {
      activeProducts.push(p);
    }
  });

  // For non-owners, remove deactivated items from local IndexedDB
  if (userRole !== 'owner' && deactivatedBarcodes.length > 0) {
    for (const barcode of deactivatedBarcodes) {
      await deleteInventoryItemByBarcode(barcode, currentShopId);
    }
  }

  let usedCostTables = effectiveTable === 'product_master';

  // Fetch batches only for active modified products
  if (activeProducts.length > 0) {
    const barcodes = activeProducts.map(p => p.barcode);
    const { batches: allBatches, usedCostTable } = await fetchBatchesForBarcodes({
      barcodes,
      currentShopId,
      allowCost: effectiveTable === 'product_master'
    });
    usedCostTables = usedCostTables && usedCostTable;

    const batchesByBarcode = {};
    allBatches.forEach(b => {
      if (b.is_active === false) return;
      if (!batchesByBarcode[b.barcode]) batchesByBarcode[b.barcode] = [];
      batchesByBarcode[b.barcode].push(b);
    });

    const mergedProducts = activeProducts.map(p => ({
      ...p,
      batches: batchesByBarcode[p.barcode] || []
    }));

    // Upsert into local IndexedDB without deleting the rest of the catalog
    await saveInventoryBatch(mergedProducts);
  }

  return { usedCostTables };
}

/**
 * Downloads the complete catalog in paginated chunks and prunes orphaned items.
 */
async function performFullSync({ tableName, userRole, currentShopId }) {
  console.log('[Full Sync] Downloading full product catalog...');
  let effectiveTable = tableName;
  let offset = 0;
  let hasMore = true;
  const syncedBarcodes = new Set();
  let usedCostTables = effectiveTable === 'product_master';

  while (hasMore) {
    let prodQuery = supabase.from(effectiveTable).select('*');
    if (userRole !== 'owner') {
      prodQuery = prodQuery.eq('is_active', true);
    }
    if (currentShopId) {
      prodQuery = prodQuery.eq('shop_id', currentShopId);
    }
    let { data: products, error: prodError } = await prodQuery.range(offset, offset + PAGE_SIZE - 1);
    
    // Fallback to public view if raw table is restricted by RLS
    if ((!products || products.length === 0 || prodError) && effectiveTable === 'product_master' && offset === 0) {
      let pubQuery = supabase.from('product_master_public').select('*');
      if (currentShopId) {
        pubQuery = pubQuery.eq('shop_id', currentShopId);
      }
      const pubRes = await pubQuery.range(offset, offset + PAGE_SIZE - 1);
      if (!pubRes.error && pubRes.data && pubRes.data.length > 0) {
        effectiveTable = 'product_master_public';
        usedCostTables = false;
        products = pubRes.data;
        prodError = null;
      }
    }
    if (prodError) throw prodError;

    if (products && products.length > 0) {
      const barcodes = products.map(p => p.barcode);
      const { batches, usedCostTable } = await fetchBatchesForBarcodes({
        barcodes,
        currentShopId,
        allowCost: effectiveTable === 'product_master'
      });
      if (!usedCostTable) {
        usedCostTables = false;
      }

      const batchesByBarcode = {};
      if (batches) {
        batches.forEach(b => {
          if (b.is_active === false) return;
          if (!batchesByBarcode[b.barcode]) batchesByBarcode[b.barcode] = [];
          batchesByBarcode[b.barcode].push(b);
        });
      }

      const mergedProducts = products.map(p => ({
        ...p,
        batches: batchesByBarcode[p.barcode] || []
      }));

      await saveInventoryBatch(mergedProducts);
      mergedProducts.forEach(item => syncedBarcodes.add(item.barcode));

      offset += PAGE_SIZE;
      if (products.length < PAGE_SIZE) {
        hasMore = false;
      }
    } else {
      hasMore = false;
    }
  }

  // Cleanup items that were deleted or deactivated remotely (ONLY in Full Sync!)
  if (syncedBarcodes.size > 0) {
    await deleteOrphanedInventory(syncedBarcodes);
  }
  console.log(`[Full Sync] Completed successfully. Synced ${syncedBarcodes.size} items.`);
  return { usedCostTables };
}

export const flushOfflineQueue = async (userRole = 'worker') => {
  try {
    const currentShopId = localStorage.getItem('shop_id');
    const tableName = 'product_master_public';
    let pingQuery = supabase.from(tableName).select('barcode');
    if (currentShopId) {
      pingQuery = pingQuery.eq('shop_id', currentShopId);
    }
    const { error: pingError } = await pingQuery.limit(1);
    if (pingError) return; // Offline, abort flush

    let queue = await getOfflineQueue(currentShopId);
    if (queue && queue.length > 0) {
      queue = queue.filter(tx => tx.status !== 'failed');
      if (queue.length > 0) {
        console.log(`Attempting to flush ${queue.length} offline transactions...`);
        window.dispatchEvent(new CustomEvent('queue_sync_start', { detail: { count: queue.length } }));

        for (const tx of queue) {
          try {
            const rpcPayload = {
              p_action: tx.p_action,
              p_location: tx.p_location,
              p_cashier_name: tx.p_cashier_name,
              p_items: tx.p_items
            };

            // Use process_pos_transaction_unsafe matching WorkerTerminal checkout, with graceful fallback
            let rpcResult = await supabase.rpc('process_pos_transaction_unsafe', rpcPayload);
            if (rpcResult.error && rpcResult.error.message?.includes('process_pos_transaction_unsafe') && rpcResult.error.message?.includes('does not exist')) {
              rpcResult = await supabase.rpc('process_pos_transaction', rpcPayload);
            }

            const { data, error } = rpcResult;
            
            if (error) {
              console.error(`Failed to sync transaction ${tx.id}:`, error);
              await markTransactionFailed(tx.id, error.message);
            } else {
              // Persist payment breakdown, customer data, and showroom status to the created bill
              if (data?.bill_id) {
                try {
                  const shopId = tx.shop_id || currentShopId || localStorage.getItem('shop_id');
                  const updatePayload = {
                    payment_method: tx.p_payment_method,
                    cash_amount: tx.p_cash_amount,
                    upi_amount: tx.p_upi_amount
                  };
                  if (shopId) {
                    updatePayload.shop_id = shopId;
                  }
                  if (tx.p_customer_name || tx.p_customer_phone) {
                    updatePayload.customer_name = tx.p_customer_name;
                    updatePayload.customer_phone = tx.p_customer_phone;
                  }
                  if (tx.p_payment_method === 'SHOWROOM') {
                    updatePayload.status = 'showroom_pending';
                  }
                  await supabase.from('bills').update(updatePayload).eq('id', data.bill_id);

                  if (tx.screw_item) {
                    const scPrice = Number(tx.screw_item.customPriceInput || tx.screw_item.price || 0);
                    try {
                      const { error: biErr } = await supabase.from('bill_items').insert({
                        bill_id: data.bill_id,
                        shop_id: shopId || null,
                        barcode: 'SCREWS',
                        name: 'Screws',
                        quantity: 1,
                        billable_quantity: 1,
                        actual_quantity: 1,
                        price_at_sale: scPrice,
                        system_price: scPrice,
                        profit: scPrice,
                        unit: 'SET'
                      });
                      if (biErr) {
                        console.warn("Could not insert screws into bill_items during offline queue flush:", biErr);
                      }
                    } catch (biErr) {
                      console.warn("Could not insert screws into bill_items during offline queue flush:", biErr);
                    }
                  }
                } catch (billUpdateErr) {
                  console.warn("Could not save additional bill metadata during offline queue flush:", billUpdateErr);
                }
              }

              await deleteOfflineTransaction(tx.id);
              console.log(`Successfully synced offline transaction ${tx.id}`);
            }
          } catch (e) {
            console.error('Exception while flushing transaction:', e);
            await markTransactionFailed(tx.id, e.message || 'Unknown exception');
          }
        }
        window.dispatchEvent(new CustomEvent('queue_sync_end'));
      }
    }
    
    // Trigger consolidated delta sync after flushing queue
    await syncInventoryToLocal(userRole);
  } catch (err) {
    console.error('Failed to flush offline queue:', err);
  }
};

let syncInterval = null;
let currentRole = 'worker';
let realtimeSyncChannel = null;

export const reconcileDeletedItems = async (userRole = 'owner') => {
  try {
    const currentShopId = localStorage.getItem('shop_id');
    const tableName = 'product_master_public';
    let bcQuery = supabase.from(tableName).select('barcode');
    if (currentShopId) bcQuery = bcQuery.eq('shop_id', currentShopId);
    if (userRole !== 'owner') bcQuery = bcQuery.eq('is_active', true);
    const { data: remoteRows, error: bcErr } = await bcQuery;
    if (!bcErr && remoteRows && remoteRows.length > 0) {
      const remoteBarcodeSet = new Set(remoteRows.map(r => String(r.barcode)));
      await deleteOrphanedInventory(remoteBarcodeSet);
      return true;
    }
  } catch (e) {
    console.warn('[Sync] Reconcile deleted items note:', e?.message);
  }
  return false;
};

export const startRealtimeSync = (userRole = 'worker') => {
  if (typeof window === 'undefined' || !supabase) return;
  if (realtimeSyncChannel) return;

  const currentShopId = localStorage.getItem('shop_id');
  const channelName = currentShopId ? `pos_catalog_rt_${currentShopId}` : 'pos_catalog_rt_global';

  realtimeSyncChannel = supabase.channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'product_master' },
      async (payload) => {
        console.log('[RealtimeSync] product_master change detected:', payload.eventType);
        if (payload.eventType === 'DELETE') {
          const deletedBarcode = payload.old?.barcode;
          if (deletedBarcode) {
            await deleteInventoryItemByBarcode(deletedBarcode, currentShopId);
          }
          await reconcileDeletedItems(userRole);
          window.dispatchEvent(new CustomEvent('inventory_sync_complete', { detail: { event: 'DELETE', barcode: deletedBarcode } }));
        } else {
          await syncInventoryToLocal(userRole);
          window.dispatchEvent(new CustomEvent('inventory_sync_complete', { detail: { event: payload.eventType } }));
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_batches' },
      async (payload) => {
        console.log('[RealtimeSync] inventory_batches change detected:', payload.eventType);
        await syncInventoryToLocal(userRole);
        window.dispatchEvent(new CustomEvent('inventory_sync_complete', { detail: { event: payload.eventType } }));
      }
    )
    .subscribe();
};

export const stopRealtimeSync = () => {
  if (realtimeSyncChannel) {
    supabase.removeChannel(realtimeSyncChannel);
    realtimeSyncChannel = null;
  }
};

let lastFocusSyncTime = 0;
const handleVisibilityOrFocusSync = () => {
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
  const now = Date.now();
  // Throttle to at most once every 15 seconds to prevent spamming
  if (now - lastFocusSyncTime < 15000) return;
  if (document.visibilityState === 'visible' && navigator.onLine) {
    lastFocusSyncTime = now;
    console.log('[BackgroundSync] Tab visible/focused, running delta sync...');
    syncInventoryToLocal(currentRole).catch(e => console.warn('[BackgroundSync] Visibility sync warning:', e?.message));
    flushOfflineQueue(currentRole).catch(e => console.warn('[BackgroundSync] Offline queue flush warning:', e?.message));
  }
};

const handleOnlineSync = () => {
  console.log('[BackgroundSync] Network is back online. Flushing queue and running delta sync...');
  flushOfflineQueue(currentRole).catch(e => console.warn('[BackgroundSync] Online queue flush warning:', e?.message));
  syncInventoryToLocal(currentRole).catch(e => console.warn('[BackgroundSync] Online delta sync warning:', e?.message));
};

export const startBackgroundSync = (userRole = 'worker') => {
  currentRole = userRole;
  // Initial sync (will be delta if already cached, full if initial launch)
  syncInventoryToLocal(userRole)
    .then(() => flushOfflineQueue(userRole))
    .catch(e => console.warn('[BackgroundSync] Initial sync warning:', e?.message));

  startRealtimeSync(userRole);

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnlineSync);
    window.addEventListener('focus', handleVisibilityOrFocusSync);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityOrFocusSync);
    }
  }

  // Setup periodic polling every 60 seconds to ensure local DB stays 100% in sync with Supabase
  if (!syncInterval) {
    syncInterval = setInterval(() => {
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        syncInventoryToLocal(currentRole).catch(e => console.warn('[BackgroundSync] Periodic sync warning:', e?.message));
        flushOfflineQueue(currentRole).catch(e => console.warn('[BackgroundSync] Periodic queue flush warning:', e?.message));
      }
    }, 60 * 1000);
  }
};

export const stopBackgroundSync = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  stopRealtimeSync();
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleOnlineSync);
    window.removeEventListener('focus', handleVisibilityOrFocusSync);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityOrFocusSync);
    }
  }
};
