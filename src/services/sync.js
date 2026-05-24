import { supabase } from '../supabaseClient';
import { 
  clearInventoryCache, 
  saveInventoryBatch, 
  getOfflineQueue, 
  deleteOfflineTransaction,
  setSyncStatus
} from './db';

const PAGE_SIZE = 500;

export const syncInventoryToLocal = async () => {
  try {
    await setSyncStatus('inventory_sync', { status: 'syncing', last_sync: null });
    
    // First, verify if we have network by doing a small ping
    const { error: pingError } = await supabase.from('inventory').select('id').limit(1);
    if (pingError) throw pingError;

    // Clear existing cache for a fresh sync
    // In a more robust system, we would do delta syncs based on updated_at
    await clearInventoryCache();

    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('inventory')
        .select('*')
        .eq('is_active', true)
        .range(offset, offset + PAGE_SIZE - 1);
        
      if (error) {
        throw error;
      }

      if (data && data.length > 0) {
        await saveInventoryBatch(data);
        offset += PAGE_SIZE;
        if (data.length < PAGE_SIZE) {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }

    await setSyncStatus('inventory_sync', { status: 'idle', last_sync: new Date().toISOString() });
    console.log('Inventory successfully synced to local DB');
  } catch (err) {
    console.error('Failed to sync inventory to local DB:', err.message);
    await setSyncStatus('inventory_sync', { status: 'error', error: err.message, last_sync: null });
  }
};

export const flushOfflineQueue = async () => {
  try {
    const queue = await getOfflineQueue();
    if (!queue || queue.length === 0) return;

    // Check connection first
    const { error: pingError } = await supabase.from('inventory').select('id').limit(1);
    if (pingError) return; // Offline, abort flush

    console.log(`Attempting to flush ${queue.length} offline transactions...`);

    for (const tx of queue) {
      try {
        const payload = {
          p_action: tx.p_action,
          p_location: tx.p_location,
          p_cashier_name: tx.p_cashier_name,
          p_items: tx.p_items
        };

        const { error } = await supabase.rpc('process_pos_transaction', payload);
        
        if (error) {
          console.error(`Failed to sync transaction ${tx.id}:`, error);
          // If it's a structural error (e.g., negative stock), we might want to log it
          // and still delete the transaction to prevent infinite loops, 
          // but for now we'll leave it in the queue for manual review.
        } else {
          await deleteOfflineTransaction(tx.id);
          console.log(`Successfully synced offline transaction ${tx.id}`);
        }
      } catch (e) {
        console.error('Exception while flushing transaction:', e);
      }
    }
  } catch (err) {
    console.error('Failed to flush offline queue:', err);
  }
};

// Polling service to keep things in sync if the app stays open for long periods
let syncInterval = null;

export const startBackgroundSync = () => {
  // Initial syncs
  syncInventoryToLocal();
  flushOfflineQueue();

  // Setup listeners for online/offline events
  window.addEventListener('online', () => {
    console.log('Network is back online. Flushing queue...');
    flushOfflineQueue();
    syncInventoryToLocal();
  });

  // Setup polling every 5 minutes to fetch new inventory changes
  // and flush the queue in case events are missed
  if (!syncInterval) {
    syncInterval = setInterval(() => {
      if (navigator.onLine) {
        flushOfflineQueue();
        syncInventoryToLocal();
      }
    }, 5 * 60 * 1000);
  }
};

export const stopBackgroundSync = () => {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
};
