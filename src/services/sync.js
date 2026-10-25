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
  const tableName = userRole === 'owner' ? 'product_master' : 'product_master_public';
  const syncKey = `inventory_sync_${currentShopId || 'global'}_${userRole}`;

  try {
    // 1. Lightweight connectivity ping
    let pingQuery = supabase.from(tableName).select('barcode');
    if (currentShopId) {
      pingQuery = pingQuery.eq('shop_id', currentShopId);
    }
    const { error: pingError } = await pingQuery.limit(1);
    if (pingError) throw pingError;

    // 2. Check previous sync status and local inventory count
    const prevStatus = await getSyncStatus(syncKey);
    const localCount = await getLocalInventoryCount(currentShopId);

    // Delta sync is activated when:
    // - Not forced to perform a full sync
    // - A valid previous last_sync timestamp exists
    // - Local IndexedDB already contains products
    const isDelta = !forceFull && Boolean(prevStatus?.last_sync) && localCount > 0;

    await setSyncStatus(syncKey, { 
      status: 'syncing', 
      last_sync: prevStatus?.last_sync || null,
      mode: isDelta ? 'delta' : 'full'
    });

    if (isDelta) {
      try {
        await performDeltaSync({
          tableName,
          userRole,
          currentShopId,
          lastSync: prevStatus.last_sync
        });
      } catch (deltaErr) {
        // Fallback to full sync if updated_at column doesn't exist yet (PostgreSQL error 42703)
        if (deltaErr.code === '42703' || deltaErr.message?.includes('updated_at')) {
          console.warn('[Sync] Database updated_at column not available yet. Falling back to full sync.');
          await performFullSync({ tableName, userRole, currentShopId });
        } else {
          throw deltaErr;
        }
      }
    } else {
      await performFullSync({ tableName, userRole, currentShopId });
    }

    const completedAt = new Date().toISOString();
    await setSyncStatus(syncKey, { 
      status: 'idle', 
      last_sync: completedAt,
      last_mode: isDelta ? 'delta' : 'full',
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
      last_sync: prevStatus?.last_sync || null 
    });
  }
};

/**
 * Downloads only products modified since `lastSync` and merges them into IndexedDB.
 */
async function performDeltaSync({ tableName, userRole, currentShopId, lastSync }) {
  const lastSyncDate = new Date(lastSync);
  const effectiveTimestamp = new Date(Math.max(0, lastSyncDate.getTime() - CLOCK_SKEW_BUFFER_MS)).toISOString();

  let prodQuery = supabase.from(tableName).select('*');
  if (currentShopId) {
    prodQuery = prodQuery.eq('shop_id', currentShopId);
  }
  // Filter by updated_at greater than the buffered previous sync timestamp
  prodQuery = prodQuery.gt('updated_at', effectiveTimestamp);

  const { data: changedProducts, error: prodError } = await prodQuery;
  if (prodError) throw prodError;

  if (!changedProducts || changedProducts.length === 0) {
    console.log('[Delta Sync] Everything is up to date (0 products modified). 0 KB transferred.');
    return true;
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

  // Fetch batches only for active modified products
  if (activeProducts.length > 0) {
    const barcodes = activeProducts.map(p => p.barcode);
    const batchTable = userRole === 'owner' ? 'inventory_batches' : 'inventory_batches_public';
    const allBatches = [];

    for (let i = 0; i < barcodes.length; i += BATCH_CHUNK_SIZE) {
      const slice = barcodes.slice(i, i + BATCH_CHUNK_SIZE);
      let batchQuery = supabase.from(batchTable).select('*').in('barcode', slice).eq('is_active', true);
      if (currentShopId) {
        batchQuery = batchQuery.eq('shop_id', currentShopId);
      }
      const { data: batches, error: batchError } = await batchQuery;
      if (batchError) throw batchError;
      if (batches) allBatches.push(...batches);
    }

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

  return true;
}

/**
 * Downloads the complete catalog in paginated chunks and prunes orphaned items.
 */
async function performFullSync({ tableName, userRole, currentShopId }) {
  console.log('[Full Sync] Downloading full product catalog...');
  let offset = 0;
  let hasMore = true;
  const syncedBarcodes = new Set();

  while (hasMore) {
    let prodQuery = supabase.from(tableName).select('*');
    if (userRole !== 'owner') {
      prodQuery = prodQuery.eq('is_active', true);
    }
    if (currentShopId) {
      prodQuery = prodQuery.eq('shop_id', currentShopId);
    }
    const { data: products, error: prodError } = await prodQuery.range(offset, offset + PAGE_SIZE - 1);
    if (prodError) throw prodError;

    if (products && products.length > 0) {
      const barcodes = products.map(p => p.barcode);
      const batchTable = userRole === 'owner' ? 'inventory_batches' : 'inventory_batches_public';
      
      let batchQuery = supabase.from(batchTable).select('*').in('barcode', barcodes).eq('is_active', true);
      if (currentShopId) {
        batchQuery = batchQuery.eq('shop_id', currentShopId);
      }
      const { data: batches, error: batchError } = await batchQuery;
      if (batchError) throw batchError;

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
  await deleteOrphanedInventory(syncedBarcodes);
  console.log(`[Full Sync] Completed successfully. Synced ${syncedBarcodes.size} items.`);
  return true;
}

export const flushOfflineQueue = async (userRole = 'worker') => {
  try {
    const currentShopId = localStorage.getItem('shop_id');
    const tableName = userRole === 'owner' ? 'product_master' : 'product_master_public';
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
                      await supabase.from('bill_items').insert({
                        bill_id: data.bill_id,
                        shop_id: shopId,
                        barcode: 'SCREWS',
                        item_name: 'Screws',
                        quantity: 1,
                        billable_quantity: 1,
                        price_at_sale: scPrice,
                        selling_price: scPrice,
                        final_price: scPrice,
                        profit: scPrice,
                        unit: 'SET'
                      });
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

const handleOnlineSync = () => {
  console.log('Network is back online. Flushing queue and running delta sync...');
  flushOfflineQueue(currentRole);
};

export const startBackgroundSync = (userRole = 'worker') => {
  currentRole = userRole;
  // Initial sync (will be delta if already cached, full if initial launch)
  syncInventoryToLocal(userRole).then(() => flushOfflineQueue(userRole));

  window.addEventListener('online', handleOnlineSync);

  // Setup periodic polling every 5 minutes to fetch any remote updates
  if (!syncInterval) {
    syncInterval = setInterval(() => {
      if (navigator.onLine) {
        flushOfflineQueue(currentRole);
      }
    }, 5 * 60 * 1000);
  }
};

export const stopBackgroundSync = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  window.removeEventListener('online', handleOnlineSync);
};
