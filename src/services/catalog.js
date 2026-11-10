import { supabase } from '../supabaseClient';
import { BARCODE_START_VALUE } from '../constants';

const PAGE = 1000;

async function fetchBarcodesFrom(table, shopId) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select('barcode');
    if (shopId) q = q.eq('shop_id', shopId);
    const { data, error } = await q.order('barcode').range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    (data || []).forEach(r => { if (r.barcode != null) all.push(String(r.barcode)); });
    if (!data || data.length < PAGE) break;
  }
  return { data: all, error: null };
}

/**
 * Every barcode used by this shop, including deleted (inactive) products, whose barcodes
 * are still taken. Supabase returns at most 1000 rows per request, so this pages through;
 * the old single query silently missed products beyond the first 1000.
 */
export async function fetchAllShopBarcodes(shopId) {
  let res = await fetchBarcodesFrom('product_master', shopId);
  if (res.error || !res.data || res.data.length === 0) {
    const pub = await fetchBarcodesFrom('product_master_public', shopId);
    if (!pub.error && pub.data && pub.data.length > 0) res = pub;
  }
  if (res.error) throw res.error;
  return res.data || [];
}

/** Highest numeric barcode + 1 (or BARCODE_START_VALUE when none exist). */
export function nextNumericBarcode(barcodes, atLeast = null) {
  const start = parseInt(BARCODE_START_VALUE, 10) - 1;
  let max = start;
  for (const b of barcodes) {
    const n = /^\d+$/.test(String(b)) ? parseInt(b, 10) : NaN;
    if (!isNaN(n) && n > max) max = n;
  }
  if (atLeast !== null && !isNaN(Number(atLeast))) max = Math.max(max, Number(atLeast) - 1);
  return String(max + 1);
}
