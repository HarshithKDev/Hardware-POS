import { supabase } from '../supabaseClient';

// After the sale RPC creates a bill, payment method / cash-UPI split / customer /
// screws line are written in a second step. That step used to be fire-and-forget:
// if it failed, the bill stayed without payment details forever. Now it is retried,
// and if it still fails it is parked in localStorage and retried by the background sync.

const PENDING_KEY = 'pos_pending_bill_patches';
const RETRY_DELAYS_MS = [0, 600, 1800];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readPending() {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writePending(list) {
  try {
    if (list.length === 0) localStorage.removeItem(PENDING_KEY);
    else localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch (e) {
    console.error('[BillFinalize] Could not persist pending bill patches:', e);
  }
}

function savePending(patch) {
  const list = readPending().filter((p) => p.billId !== patch.billId);
  list.push({ ...patch, queued_at: patch.queued_at || new Date().toISOString() });
  writePending(list);
}

export function getPendingBillPatchCount() {
  return readPending().length;
}

async function applyOnce({ billId, updatePayload, screwRow }, attempt) {
  if (updatePayload && Object.keys(updatePayload).length > 0) {
    // Idempotent: safe to repeat
    const { error } = await supabase.from('bills').update(updatePayload).eq('id', billId);
    if (error) throw error;
  }

  if (screwRow) {
    // Not idempotent: check first so a retry after an ambiguous failure can't add a second screws line
    const { data: existing, error: checkError } = await supabase
      .from('bill_items')
      .select('id')
      .eq('bill_id', billId)
      .eq('barcode', 'SCREWS')
      .limit(1);
    if (checkError) {
      // On the very first attempt nothing can have been inserted yet, so inserting is safe
      if (attempt > 0) throw checkError;
    } else if (existing && existing.length > 0) {
      return;
    }
    const { error: insertError } = await supabase.from('bill_items').insert(screwRow);
    if (insertError) throw insertError;
  }
}

/**
 * Apply the post-RPC bill metadata with retries. Never throws.
 * @returns {Promise<{ ok: boolean, queued: boolean, error?: string }>}
 */
export async function finalizeBillMetadata({ billId, updatePayload, screwRow = null }) {
  if (!billId) return { ok: true, queued: false };
  const patch = { billId, updatePayload, screwRow };
  let lastError = null;

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (RETRY_DELAYS_MS[attempt]) await sleep(RETRY_DELAYS_MS[attempt]);
    try {
      await applyOnce(patch, attempt);
      return { ok: true, queued: false };
    } catch (e) {
      lastError = e;
      console.warn(`[BillFinalize] Attempt ${attempt + 1} failed for bill ${billId}:`, e?.message || e);
    }
  }

  // The first attempt may have inserted the screws line before failing; later attempts always check first.
  savePending({ ...patch, attempts: RETRY_DELAYS_MS.length, last_error: lastError?.message || String(lastError) });
  return { ok: false, queued: true, error: lastError?.message || String(lastError) };
}

/**
 * Retry every parked bill patch. Called from the background sync.
 */
export async function flushPendingBillPatches() {
  const list = readPending();
  if (list.length === 0) return;

  const remaining = [];
  for (const patch of list) {
    try {
      // attempt index > 0 → screws insert only happens after a successful "already exists?" check
      await applyOnce(patch, 1);
      console.log(`[BillFinalize] Recovered payment details for bill ${patch.billId}`);
    } catch (e) {
      remaining.push({ ...patch, attempts: (patch.attempts || 0) + 1, last_error: e?.message || String(e) });
    }
  }

  // Merge with anything added while we were flushing
  const current = readPending();
  const handled = new Set(list.map((p) => p.billId));
  writePending([...remaining, ...current.filter((p) => !handled.has(p.billId))]);
}
