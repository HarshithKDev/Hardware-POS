/**
 * Realtime Terminal Stock Broadcasting Service
 * Uses Supabase Realtime Channels to broadcast and receive instant stock updates across
 * all active counter terminals, preventing two cashiers from selling the last stock items simultaneously.
 */

import { supabase } from '../supabaseClient';
import { getInventoryItemByBarcode, saveInventoryBatch } from './db';

// Module-level reference to the active subscription channel for efficient broadcast reuse
let activeSubscriptionChannel = null;

// Generate or retrieve persistent terminal ID for the active browser session
export function getTerminalId() {
  if (typeof window === 'undefined') return 'term_server';
  let termId = sessionStorage.getItem('pos_terminal_session_id');
  if (!termId) {
    termId = 'term_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
    sessionStorage.setItem('pos_terminal_session_id', termId);
  }
  return termId;
}

/**
 * Broadcast stock modifications (checkout, receive, transfer) to all peer terminals
 */
export async function broadcastStockUpdate({
  type = 'checkout',
  items = [],
  shopId = null
}) {
  if (!navigator.onLine || !supabase) return false;
  if (!items || items.length === 0) return false;

  const terminalId = getTerminalId();
  const effectiveShopId = shopId || (typeof localStorage !== 'undefined' ? localStorage.getItem('shop_id') : null);

  const payload = {
    senderTerminalId: terminalId,
    shopId: effectiveShopId,
    type,
    items: items.map(i => ({
      barcode: String(i.barcode),
      quantity: Number(i.quantity || 1),
      name: i.name || ''
    })),
    timestamp: Date.now()
  };

  try {
    const channelName = effectiveShopId ? `pos_stock_${effectiveShopId}` : 'pos_stock_broadcast';
    let channel = activeSubscriptionChannel;
    if (!channel || channel.topic !== `realtime:${channelName}`) {
      channel = supabase.channel(channelName);
    }

    // Ensure channel is in joined/subscribed state before broadcasting
    if (channel.state !== 'joined') {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 1500);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }

    // Send broadcast event
    await channel.send({
      type: 'broadcast',
      event: 'stock_mutation',
      payload
    });

    return true;
  } catch (err) {
    console.warn("[RealtimeStock] Failed to broadcast stock update:", err);
    return false;
  }
}

/**
 * Subscribe to realtime stock broadcasts from peer terminals with self-echo suppression
 * and multi-tenant store isolation
 */
export function subscribeToStockUpdates({
  shopId = null,
  onStockUpdate = null,
  onCartConflict = null,
  getCartItems = null
}) {
  if (typeof window === 'undefined' || !supabase) {
    return { unsubscribe: () => {} };
  }

  const currentTerminalId = getTerminalId();
  const effectiveShopId = shopId || (typeof localStorage !== 'undefined' ? localStorage.getItem('shop_id') : null);
  const channelName = effectiveShopId ? `pos_stock_${effectiveShopId}` : 'pos_stock_broadcast';

  const channel = supabase.channel(channelName);

  channel
    .on('broadcast', { event: 'stock_mutation' }, async ({ payload }) => {
      if (!payload) return;

      // 1. Self-Echo Suppression: Ignore broadcasts sent by this active terminal
      if (payload.senderTerminalId === currentTerminalId) {
        return;
      }

      // 2. Multi-Store Isolation: Ignore broadcasts meant for a different shop
      if (effectiveShopId && payload.shopId && payload.shopId !== effectiveShopId) {
        return;
      }

      const { type, items } = payload;
      if (!items || !Array.isArray(items)) return;

      // 3. Immediately update local IndexedDB stock so terminal has latest stock numbers
      try {
        for (const item of items) {
          const localItem = await getInventoryItemByBarcode(item.barcode);
          if (localItem) {
            const qty = Number(item.quantity || 0);
            if (type === 'checkout') {
              localItem.stock_store = Math.max(0, (Number(localItem.stock_store) || 0) - qty);
            } else if (type === 'receive') {
              localItem.stock_warehouse = (Number(localItem.stock_warehouse) || 0) + qty;
            } else if (type === 'transfer') {
              localItem.stock_warehouse = Math.max(0, (Number(localItem.stock_warehouse) || 0) - qty);
              localItem.stock_store = (Number(localItem.stock_store) || 0) + qty;
            }
            await saveInventoryBatch([localItem]);

            // 4. Check if current cashier has this item in cart and stock is now depleted
            if (type === 'checkout' && getCartItems && onCartConflict) {
              const currentCart = getCartItems();
              const inCart = currentCart.find(c => String(c.barcode) === String(item.barcode));
              if (inCart && Number(localItem.stock_store) < Number(inCart.quantity)) {
                onCartConflict({
                  item: inCart,
                  remainingStoreStock: localItem.stock_store,
                  deductedQty: qty,
                  terminalId: payload.senderTerminalId
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn("[RealtimeStock] Error applying peer stock update to IndexedDB:", err);
      }

      // 5. Trigger component callback (e.g. invalidate React Query queries)
      if (onStockUpdate) {
        onStockUpdate(payload);
      }
    })
    .subscribe();

  activeSubscriptionChannel = channel;

  return {
    channel,
    unsubscribe: () => {
      if (activeSubscriptionChannel === channel) {
        activeSubscriptionChannel = null;
      }
      supabase.removeChannel(channel);
    }
  };
}
