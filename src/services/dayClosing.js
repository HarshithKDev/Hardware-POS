import { supabase } from '../supabaseClient';
import { localToUtcIso } from '../utils';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const isShowroomBill = (b) =>
  b.payment_method === 'SHOWROOM' || b.status === 'showroom' || b.status === 'showroom_pending';

/** Cash / UPI part of a bill (older bills may not have the split saved). */
export function billPaymentSplit(b) {
  const total = Number(b.total_amount) || 0;
  const hasCash = b.cash_amount !== null && b.cash_amount !== undefined;
  const hasUpi = b.upi_amount !== null && b.upi_amount !== undefined;
  if (b.payment_method === 'CASH') return { cash: hasCash ? Number(b.cash_amount) : total, upi: 0 };
  if (b.payment_method === 'UPI') return { cash: 0, upi: hasUpi ? Number(b.upi_amount) : total };
  if (b.payment_method === 'SPLIT') {
    const upi = hasUpi ? Number(b.upi_amount) : 0;
    const cash = hasCash ? Number(b.cash_amount) : Math.max(0, total - upi);
    return { cash, upi };
  }
  return { cash: hasCash ? Number(b.cash_amount) : 0, upi: hasUpi ? Number(b.upi_amount) : 0 };
}

/**
 * Pure calculation of the day's closing figures (unit tested).
 *
 * Returns reduce the original bill in place, so today's bills already show sales net of
 * returns made on them. Refunds paid today for bills from EARLIER days are extra money
 * leaving the drawer today, so they are subtracted separately.
 *
 * expected cash in drawer = opening cash + cash sales (net)
 *                           - cash refunds on earlier days' bills - cash expenses
 */
export function computeDayClosing({ bills = [], returns = [], expenses = [], openingCash = 0, countedCash = null, returnsAvailable = true }) {
  const storeBills = bills.filter((b) => (b.location ?? 'Store') === 'Store' && (b.payment_method || Number(b.total_amount) > 0 || b.status === 'voided'));
  const showroom = storeBills.filter(isShowroomBill);
  const saleBills = storeBills.filter((b) => !isShowroomBill(b));
  const active = saleBills.filter((b) => b.status !== 'voided');
  const voided = saleBills.filter((b) => b.status === 'voided');

  const sales = { count: active.length, total: 0, cash: 0, upi: 0 };
  const byCashierMap = new Map();
  for (const b of active) {
    const { cash, upi } = billPaymentSplit(b);
    const total = Number(b.total_amount) || 0;
    sales.total += total; sales.cash += cash; sales.upi += upi;
    const name = (b.cashier_name || 'Unknown').trim() || 'Unknown';
    const row = byCashierMap.get(name) || { name, count: 0, total: 0, cash: 0, upi: 0 };
    row.count += 1; row.total += total; row.cash += cash; row.upi += upi;
    byCashierMap.set(name, row);
  }

  const todaysBillIds = new Set(saleBills.map((b) => String(b.id)));
  const ret = { count: 0, cash: 0, upi: 0, earlierCount: 0, earlierCash: 0, earlierUpi: 0 };
  for (const r of returns) {
    const amt = Number(r.refund_amount) || 0;
    const isUpi = String(r.refund_method || '').toUpperCase() === 'UPI';
    ret.count += 1;
    if (isUpi) ret.upi += amt; else ret.cash += amt;
    if (!todaysBillIds.has(String(r.original_bill_id))) {
      ret.earlierCount += 1;
      if (isUpi) ret.earlierUpi += amt; else ret.earlierCash += amt;
    }
  }

  const exp = { count: expenses.length, total: 0, cash: 0, upi: 0, unspecified: 0 };
  for (const e of expenses) {
    const amt = Number(e.amount) || 0;
    const mode = String(e.payment_mode || '').toUpperCase();
    exp.total += amt;
    if (mode === 'CASH') exp.cash += amt;
    else if (mode) exp.upi += amt;
    else exp.unspecified += amt;
  }

  const showroomOut = { count: showroom.length, value: showroom.reduce((s, b) => s + (Number(b.total_amount) || 0), 0) };

  const opening = Number(openingCash) || 0;
  // expenses without a payment mode (older entries) are treated as paid in cash
  const expectedCash = opening + sales.cash - ret.earlierCash - exp.cash - exp.unspecified;
  const expectedUpi = sales.upi - ret.earlierUpi - exp.upi;
  const counted = countedCash === null || countedCash === '' || countedCash === undefined ? null : Number(countedCash);

  const r2 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' && k !== 'count' && !k.endsWith('Count') ? round2(v) : v]));
  return {
    sales: r2(sales),
    fullyReturned: { count: voided.length, value: round2(voided.reduce((s, b) => s + (Number(b.total_amount) || 0), 0)) },
    returns: r2(ret),
    returnsAvailable,
    expenses: r2(exp),
    showroom: r2(showroomOut),
    byCashier: [...byCashierMap.values()].map(r2).sort((a, b) => b.total - a.total),
    openingCash: round2(opening),
    expectedCash: round2(expectedCash),
    expectedUpi: round2(expectedUpi),
    countedCash: counted === null || Number.isNaN(counted) ? null : round2(counted),
    difference: counted === null || Number.isNaN(counted) ? null : round2(counted - expectedCash),
  };
}

/** Loads everything the closing report needs for one day ("YYYY-MM-DD", local time). */
export async function fetchDayClosingData(shopId, day) {
  const start = localToUtcIso(`${day}T00:00:00`);
  const end = localToUtcIso(`${day}T23:59:59.999`);

  let billsQ = supabase
    .from('bills')
    .select('id, total_amount, cash_amount, upi_amount, payment_method, status, cashier_name, location, created_at')
    .gte('created_at', start).lte('created_at', end)
    .eq('location', 'Store');
  if (shopId) billsQ = billsQ.eq('shop_id', shopId);

  let returnsQ = supabase
    .from('returns')
    .select('id, original_bill_id, refund_method, refund_amount, created_at')
    .gte('created_at', start).lte('created_at', end);
  if (shopId) returnsQ = returnsQ.eq('shop_id', shopId);

  let expensesQ = supabase
    .from('expenses')
    .select('id, amount, payment_mode, category, created_at')
    .gte('created_at', start).lte('created_at', end);
  if (shopId) expensesQ = expensesQ.eq('shop_id', shopId);

  const [billsRes, returnsRes, expensesRes] = await Promise.all([billsQ, returnsQ, expensesQ]);
  if (billsRes.error) throw billsRes.error;
  if (expensesRes.error) throw expensesRes.error;
  return {
    bills: billsRes.data || [],
    expenses: expensesRes.data || [],
    // returns are recorded since the database update; if unavailable, the report says so
    returns: returnsRes.error ? [] : (returnsRes.data || []),
    returnsAvailable: !returnsRes.error,
  };
}
