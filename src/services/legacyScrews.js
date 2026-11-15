// Very old bills recorded a screws charge in the bill total but not as a bill line. Those bills
// get a "Screws" line rebuilt from the gap between the total and the lines.
//
// A negotiated total is spread over the items with each price rounded to paise, so the lines can
// also fall a few paise short of the total. That gap is rounding, not screws: it must never turn
// into a "Screws ₹0.01" line.

export const isScrewLine = (it) => it?.barcode === 'SCREWS' || it?.name === 'Screws' || Boolean(it?.is_screw);

/** Rupees of unrecorded screws on an old bill, or 0. */
export function legacyScrewAmount(bill, lines = []) {
  const totalCents = Math.round(Number(bill?.total_amount || 0) * 100);
  if (!(totalCents > 0) || lines.some(isScrewLine)) return 0;
  let linesCents = 0;
  let units = 0;
  lines.forEach((it) => {
    const qty = Number(it.billable_quantity || it.quantity || 1);
    linesCents += Math.round(Number(it.price_at_sale || 0) * qty * 100);
    units += Math.abs(qty);
  });
  // Each unit price is rounded to the nearest paisa: at most half a paisa per unit
  const roundingCents = Math.ceil(units * 0.5) + 1;
  const gapCents = totalCents - linesCents;
  return gapCents > roundingCents ? gapCents / 100 : 0;
}

/** The bill's lines, plus a rebuilt "Screws" line when an old bill needs one. */
export function withLegacyScrews(bill, lines = [], extra = {}) {
  const amount = legacyScrewAmount(bill, lines);
  if (!amount) return lines;
  return [...lines, {
    id: `screw-legacy-${bill.id}`,
    bill_id: bill.id,
    barcode: 'SCREWS',
    name: 'Screws',
    quantity: 1,
    billable_quantity: 1,
    actual_quantity: 1,
    price_at_sale: amount,
    system_price: amount,
    selling_price: amount,
    profit: amount,
    cost_allocated: 0,
    unit: 'SET',
    is_screw: true,
    ...extra,
  }];
}
