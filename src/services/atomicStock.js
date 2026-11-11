import { supabase } from '../supabaseClient';
import { removeStockAtomic } from './posRpc';

/**
 * Concurrency-safe read-modify-write for a single row (compare-and-swap).
 *
 * Why: stock used to be updated as "read value -> compute in JS -> write absolute
 * value". If two terminals did that at the same moment, one change was silently
 * lost. Here the UPDATE only applies if the columns still hold the values we read;
 * otherwise we re-read and recompute (optimistic locking). No DB changes needed.
 *
 * @param {object}   opts
 * @param {string}   opts.table    Table name.
 * @param {object}   opts.match    Equality filters identifying exactly one row (e.g. { batch_id, shop_id }).
 *                                 Keys with null/undefined values are ignored.
 * @param {string[]} opts.columns  Columns to read and guard (e.g. ['stock_store', 'stock_warehouse']).
 * @param {(current: object) => ({ update: object, result?: any } | null)} opts.compute
 *                                 Returns the new values to write, or null to skip writing.
 * @param {number}   [opts.maxAttempts=6]
 * @returns {Promise<{ applied: boolean, notFound?: boolean, skipped?: boolean, result?: any, current?: object }>}
 */
export async function casUpdateRow({ table, match, columns, compute, maxAttempts = 6 }) {
  const applyMatch = (q) => {
    for (const [key, value] of Object.entries(match)) {
      if (value !== null && value !== undefined && value !== '') q = q.eq(key, value);
    }
    return q;
  };

  let previousSnapshot = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { data: current, error: readError } = await applyMatch(
      supabase.from(table).select(columns.join(', '))
    ).maybeSingle();
    if (readError) throw readError;
    if (!current) return { applied: false, notFound: true };

    // If the previous write matched nothing but the row is unchanged, nobody else changed it:
    // the database refused the update for this account (row-level permissions).
    const snapshot = JSON.stringify(columns.map(c => current[c]));
    if (previousSnapshot !== null && snapshot === previousSnapshot) {
      throw new Error('This account is not allowed to change stock for this item. Please ask the owner.');
    }

    const out = compute(current);
    if (!out || !out.update) return { applied: false, skipped: true, current };

    let updateQuery = applyMatch(supabase.from(table).update(out.update, { count: 'exact' }));
    for (const col of columns) {
      updateQuery = current[col] === null || current[col] === undefined
        ? updateQuery.is(col, null)
        : updateQuery.eq(col, current[col]);
    }
    const { error: updateError, count } = await updateQuery;
    if (updateError) throw updateError;

    // count === 0 means another terminal changed the row between our read and write.
    // If the server didn't report a count at all, fall back to the legacy behaviour (assume applied).
    if (count === null || count === undefined || count > 0) {
      return { applied: true, result: out.result, current };
    }

    previousSnapshot = snapshot;
    // Small randomized backoff before re-reading
    await new Promise((r) => setTimeout(r, 40 * attempt + Math.floor(Math.random() * 60)));
  }

  throw new Error('Stock was being changed by another terminal at the same time. Please try again.');
}

/**
 * When the warehouse is disabled, received stock still lands in the warehouse first
 * (server behaviour), so it is moved to the store right after. Used both for live
 * receipts and for receipts that were queued offline and synced later.
 *
 * @param {object}   opts
 * @param {Array<{ barcode: string, qty: number, batch_id?: string, batch_number?: number }>} opts.entries
 * @param {string}   [opts.shopId]
 */
export async function routeReceivedStockToStore({ entries, shopId }) {
  for (const entry of entries) {
    const effectiveStockQty = Number(entry.qty) || 0;
    if (!entry.barcode || !(effectiveStockQty > 0)) continue;

    let bQuery = supabase
      .from('inventory_batches')
      .select('batch_id, stock_warehouse, stock_store')
      .eq('barcode', entry.barcode);

    if (entry.batch_id) {
      bQuery = bQuery.eq('batch_id', entry.batch_id);
    } else if (entry.batch_number !== undefined && entry.batch_number !== null) {
      bQuery = bQuery.eq('batch_number', entry.batch_number);
    } else {
      bQuery = bQuery.order('created_at', { ascending: false }).limit(1);
    }

    if (shopId) {
      bQuery = bQuery.eq('shop_id', shopId);
    }
    const { data: bData } = await bQuery.maybeSingle();

    if (bData && Number(bData.stock_warehouse) > 0) {
      // Atomic move (compare-and-swap) so a concurrent sale/transfer on another terminal isn't
      // overwritten. Product totals are recalculated from batches by the database.
      await casUpdateRow({
        table: 'inventory_batches',
        match: { batch_id: bData.batch_id, shop_id: shopId },
        columns: ['stock_warehouse', 'stock_store'],
        compute: (cur) => {
          const wh = Number(cur.stock_warehouse || 0);
          const qty = Math.min(wh, effectiveStockQty);
          if (!(qty > 0)) return null;
          return {
            update: {
              stock_warehouse: Math.max(0, wh - qty),
              stock_store: Number(cur.stock_store || 0) + qty
            },
            result: qty
          };
        }
      });
    }
  }
}

/**
 * Remove scrapped / damaged stock from one batch (e.g. "10 ft of pipe offcuts").
 * Only the total is reduced — no pieces are tracked.
 *
 * @param {object} opts
 * @param {string} opts.batchId
 * @param {string} opts.barcode
 * @param {string} [opts.shopId]
 * @param {number} opts.qty            Quantity to remove, in the product's unit.
 * @param {'store'|'warehouse'} opts.location  Where the scrap is.
 * @param {boolean} [opts.allowOtherLocation] Take any remainder from the other location
 *        (used when the warehouse is disabled and everything counts as store stock).
 * @returns {Promise<{ fromStore: number, fromWarehouse: number }>}
 */
export async function scrapBatchStock({ batchId, barcode, shopId, qty, location, allowOtherLocation = false, actionType = 'SCRAP', note = null, performedBy = null }) {
  const amount = Math.round(Number(qty) * 1000) / 1000;
  if (!(amount > 0)) throw new Error('Enter a quantity greater than 0.');

  // One database call: stock change + audit log together (after the database update)
  const atomic = await removeStockAtomic({
    batchId, qty: amount, location, allowOther: allowOtherLocation, actionType, note, performedBy,
  });
  if (!atomic.unavailable) {
    if (atomic.error) throw new Error(atomic.error.message || 'Could not update stock.');
    return {
      fromStore: Number(atomic.data?.from_store || 0),
      fromWarehouse: Number(atomic.data?.from_warehouse || 0),
      audited: true,
    };
  }
  // Fallback (before the database update): guarded batch update; the product's totals
  // are recalculated from its batches by the database.
  const res = await casUpdateRow({
    table: 'inventory_batches',
    match: { batch_id: batchId, shop_id: shopId },
    columns: ['stock_store', 'stock_warehouse'],
    compute: (cur) => {
      const store = Number(cur.stock_store || 0);
      const whse = Number(cur.stock_warehouse || 0);
      const primary = location === 'warehouse' ? whse : store;
      const secondary = location === 'warehouse' ? store : whse;
      const available = primary + (allowOtherLocation ? secondary : 0);
      if (amount > available + 1e-9) {
        throw new Error(`Only ${Math.round(available * 100) / 100} available in this batch${allowOtherLocation ? '' : ` (${location})`}; cannot scrap ${amount}.`);
      }
      const fromPrimary = Math.min(primary, amount);
      const fromSecondary = Math.round((amount - fromPrimary) * 1000) / 1000;
      const fromStore = location === 'warehouse' ? fromSecondary : fromPrimary;
      const fromWarehouse = location === 'warehouse' ? fromPrimary : fromSecondary;
      return {
        update: {
          stock_store: Math.round((store - fromStore) * 1000) / 1000,
          stock_warehouse: Math.round((whse - fromWarehouse) * 1000) / 1000,
        },
        result: { fromStore, fromWarehouse },
      };
    },
  });
  if (res.notFound) throw new Error('This batch no longer exists. Refresh and try again.');
  const { fromStore, fromWarehouse } = res.result;

  return { fromStore, fromWarehouse, audited: false };
}
