// Inventory "Edit Selected": what to save for one product.
//
// The on-screen product carries app-only data (its list of batches, stock totals worked out
// from them), so it must never be written back to product_master as a whole. Only the fields
// the edit form offers are compared with the original, and only real changes are sent.

const activeBatchesOf = (item) => (item?.batches || []).filter(b => b.is_active !== false);

const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

/**
 * @returns {{
 *   changes: object,            // product_master columns to update (empty = nothing changed)
 *   batchCost: {batch_id, purchase_cost} | null, // the single active batch to give the new cost
 *   costKeptOnBatches: boolean, // cost changed but several batches keep their own costs
 *   error: string | null
 * }}
 */
export function productEditChanges(original, edited) {
  const out = { changes: {}, batchCost: null, costKeptOnBatches: false, error: null };
  if (!original || !edited) return out;
  const label = original.name || original.barcode;

  const name = String(edited.name ?? '').trim();
  if (!name) return { ...out, error: `${label}: the name cannot be empty.` };
  if (name !== String(original.name ?? '').trim()) out.changes.name = name;

  for (const field of ['category', 'sub_category']) {
    const v = edited[field] || null;
    if (v !== (original[field] || null)) out.changes[field] = v;
  }

  const cost = numOrNull(edited.cost_price);
  if (cost !== null && !(cost >= 0)) return { ...out, error: `${label}: enter a cost price of 0 or more.` };
  if (cost !== numOrNull(original.cost_price)) {
    out.changes.cost_price = cost;
    const active = activeBatchesOf(original);
    if (cost !== null && active.length === 1) {
      out.batchCost = { batch_id: active[0].batch_id, purchase_cost: cost };
    } else if (active.length > 1) {
      out.costKeptOnBatches = true;
    }
  }

  // Stock can only be typed for items without batches; with batches it is their sum
  if (activeBatchesOf(original).length === 0) {
    for (const field of ['stock_store', 'stock_warehouse']) {
      if (edited[field] === undefined) continue;
      const v = numOrNull(edited[field]);
      if (v !== null && !(v >= 0)) return { ...out, error: `${label}: stock cannot be negative.` };
      if ((v ?? 0) !== Number(original[field] || 0)) out.changes[field] = v ?? 0;
    }
  }
  return out;
}
