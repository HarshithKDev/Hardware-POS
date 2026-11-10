// Builds the item list sent to the sale/receive/transfer database function.
// Kept separate (and tested) because the database function is not in this repo, so the
// field shape must stay exactly what it already accepts.

/**
 * @param {Array} cart       Cart lines (screws are excluded; they are saved separately).
 * @param {'checkout'|'receive'|'transfer'} activeTab
 */
export function buildTransactionItems(cart, activeTab) {
  return cart.filter(i => !i.is_screw && i.barcode !== 'SCREWS').map(i => {
    let calcQuantity = Number(i.quantity);
    if (i.is_cuttable) {
      // Cut-length items are tracked as a total only (e.g. 200 ft), no pieces
      calcQuantity = Math.round(Number(i.actual_quantity !== undefined && i.actual_quantity !== '' ? i.actual_quantity : i.quantity) * 100) / 100;
    }
    // Keep the exact field shape the sale function already handles:
    //  - a receipt is sent as ONE length of the total (num_rolls 1 × total length)
    //  - a sale/transfer sends the total; no per-piece cut is tracked any more
    const cuttableReceive = i.is_cuttable && activeTab === 'receive';
    const finalPrice = i.customPriceInput !== undefined && i.customPriceInput !== '' ? Number(i.customPriceInput) : Number(i.price || 0);
    return {
      barcode: i.barcode,
      name: i.name,
      batch_id: i.batch_id || null,
      actual_quantity: calcQuantity,
      billable_quantity: i.billableQuantity !== undefined && i.billableQuantity !== '' ? Number(i.billableQuantity) : (i.is_cuttable ? Number(i.quantity) : calcQuantity),
      system_price: i.selling_price !== undefined ? Number(i.selling_price) : Number(i.price || 0),
      final_price: finalPrice,
      negotiated_discount: i.discountPct || 0,
      unit: i.unit,
      instance_barcode: null,
      cut_length: (i.is_cuttable && activeTab === 'checkout') ? Math.min(calcQuantity, Number(i.default_length) || calcQuantity) : null,
      discard_scrap: false,
      num_rolls: cuttableReceive ? 1 : null,
      default_length: cuttableReceive ? calcQuantity : (i.default_length ? Number(i.default_length) : null),
      default_width: cuttableReceive ? (i.unit === 'SQFT' ? 1 : null) : (i.default_width ? Number(i.default_width) : null),
      purchase_cost: i.purchase_cost !== undefined ? Number(i.purchase_cost) : (i.cost_price ? Number(i.cost_price) : 0),
      selling_price: i.selling_price !== undefined ? Number(i.selling_price) : (i.price ? Number(i.price) : 0),
      msp: i.msp_price !== undefined ? Number(i.msp_price) : (i.msp ? Number(i.msp) : 0)
    };
  });
}
