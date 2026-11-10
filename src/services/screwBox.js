import { supabase } from '../supabaseClient';
import { scrapBatchStock } from './atomicStock';
import { getInventoryItemByBarcode, saveInventoryBatch } from './db';
import { getPerformedBy } from '../utils';

const boxesInStore = (batch, isWarehouseDisabled) =>
  Number(batch?.stock_store || 0) + (isWarehouseDisabled ? Number(batch?.stock_warehouse || 0) : 0);

/** Store boxes available across all batches. */
export function storeBoxCount(item, isWarehouseDisabled) {
  const batches = (item?.batches || []).filter(b => b.is_active !== false);
  if (batches.length === 0) {
    return Number(item?.stock_store || 0) + (isWarehouseDisabled ? Number(item?.stock_warehouse || 0) : 0);
  }
  return batches.reduce((s, b) => s + boxesInStore(b, isWarehouseDisabled), 0);
}

/** Oldest batch (lowest batch number) that has at least one box in the store. */
export function pickBoxBatch(item, isWarehouseDisabled) {
  return [...(item?.batches || [])]
    .filter(b => b.is_active !== false && boxesInStore(b, isWarehouseDisabled) >= 1)
    .sort((a, b) => Number(a.batch_number || 0) - Number(b.batch_number || 0))[0] || null;
}

/**
 * Open ONE screw box for loose sale: removes 1 box from store stock (and therefore from
 * inventory value). Not a sale — nothing is billed. Recorded in the audit log.
 */
export async function openScrewBox({ item, batch = null, shopId, isWarehouseDisabled = false }) {
  const targetBatch = batch || pickBoxBatch(item, isWarehouseDisabled);
  if (!targetBatch || boxesInStore(targetBatch, isWarehouseDisabled) < 1) {
    throw new Error(`No ${item?.name || 'boxes'} left in store stock to open.`);
  }
  const currentShopId = shopId || localStorage.getItem('shop_id');

  const { fromStore, fromWarehouse } = await scrapBatchStock({
    batchId: targetBatch.batch_id,
    barcode: item.barcode,
    shopId: currentShopId,
    qty: 1,
    location: 'store',
    allowOtherLocation: isWarehouseDisabled,
  });

  try {
    await supabase.from('audit_logs').insert([{
      shop_id: currentShopId,
      action_type: 'BOX_OPENED',
      barcode: item.barcode,
      item_name: item.name,
      changes: `Opened 1 box for loose sale (Batch ${targetBatch.batch_number || 1}) — removed from stock, not a sale`,
      performed_by: getPerformedBy(),
    }]);
  } catch (e) {
    console.warn('Could not write box-opened audit log:', e);
  }

  // Update this device's copy right away; background sync confirms it
  try {
    const localItem = await getInventoryItemByBarcode(item.barcode);
    const b = localItem?.batches?.find(x => x.batch_id === targetBatch.batch_id);
    if (b) {
      b.stock_store = Math.max(0, Number(b.stock_store || 0) - fromStore);
      b.stock_warehouse = Math.max(0, Number(b.stock_warehouse || 0) - fromWarehouse);
      await saveInventoryBatch([localItem]);
    }
  } catch (e) {
    console.warn('Could not update local stock after opening a box:', e);
  }

  return { batch: targetBatch };
}
