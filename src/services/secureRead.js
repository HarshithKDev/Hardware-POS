import { supabase } from '../supabaseClient';

/**
 * Staff devices read prices/stock/bills through views that leave out cost and profit
 * columns; the owner reads the full tables. After the database update
 * (20261111_cost_protection.sql) the full tables are owner-only.
 *
 * If a view is missing (database not updated yet) or fails, the read falls back to the
 * table, so the app works before and after the update.
 */
const STAFF_VIEW = {
  product_master: 'product_master_public',
  inventory_batches: 'inventory_batches_public',
  bills: 'bills_public',
  bill_items: 'bill_items_public',
};

const unavailableViews = new Set();

export const isOwnerSession = () => {
  try {
    return (sessionStorage.getItem('posUserRole') || localStorage.getItem('posUserRole')) === 'owner';
  } catch {
    return false;
  }
};

/**
 * Runs `build(queryBuilder)` against the right source and returns its { data, error }.
 *   await readRows('bills', (q) => q.select('*').eq('id', billId))
 * @param {string} table  base table name
 * @param {(q: any) => PromiseLike<{data: any, error: any}>} build
 * @param {{ owner?: boolean }} [opts]  defaults to the signed-in role
 */
export async function readRows(table, build, { owner = isOwnerSession() } = {}) {
  const view = STAFF_VIEW[table];
  if (owner || !view || unavailableViews.has(view)) {
    return build(supabase.from(table));
  }
  const res = await build(supabase.from(view));
  if (res && res.error) {
    const msg = `${res.error.code || ''} ${res.error.message || ''}`;
    // remember views that don't exist yet so we don't ask twice
    if (/PGRST205|42P01|does not exist|Could not find the table/i.test(msg)) unavailableViews.add(view);
    return build(supabase.from(table));
  }
  return res;
}

/** Table/view name a staff or owner read should use (for code that needs the name only). */
export const readSourceFor = (table, owner = isOwnerSession()) =>
  (owner || !STAFF_VIEW[table] || unavailableViews.has(STAFF_VIEW[table])) ? table : STAFF_VIEW[table];
