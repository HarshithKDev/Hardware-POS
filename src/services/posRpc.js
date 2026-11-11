import { supabase } from '../supabaseClient';

// Calls to the all-or-nothing database functions added by
// supabase/migrations/20261111_atomic_actions.sql. Until that script has been run,
// the functions don't exist and callers fall back to the previous step-by-step path.

const AVAILABLE_FLAG = 'pos_atomic_rpc_available';

/** True when the error means "this database function doesn't exist (yet)". */
export function isMissingFunctionError(error, fnName) {
  if (!error) return false;
  const msg = String(error.message || '');
  const missing = error.code === 'PGRST202' || error.code === '42883' ||
    /could not find the function|function .* does not exist/i.test(msg);
  return missing && (!fnName || msg.includes(fnName) || error.code === 'PGRST202');
}

/** Whether the one-call sale function has been seen working on this device. */
export function atomicSaleKnownAvailable() {
  try { return localStorage.getItem(AVAILABLE_FLAG) === 'true'; } catch { return false; }
}

function rememberAvailability(available) {
  try {
    if (available) localStorage.setItem(AVAILABLE_FLAG, 'true');
    else localStorage.removeItem(AVAILABLE_FLAG);
  } catch { /* ignore */ }
}

/**
 * Sale / receive / transfer in one database call (stock, bill, payment details,
 * customer, screws line, showroom status). The client reference makes a retry of
 * the same checkout return the first bill instead of creating a second one.
 * @returns {Promise<{ data?: any, error?: any, unavailable?: boolean }>}
 */
export async function processSaleAtomic(args) {
  const { data, error } = await supabase.rpc('pos_process_sale', {
    p_action: args.action,
    p_location: args.location,
    p_cashier_name: args.cashierName,
    p_items: args.items,
    p_payment_method: args.paymentMethod ?? null,
    p_cash_amount: args.cashAmount ?? 0,
    p_upi_amount: args.upiAmount ?? 0,
    p_total_amount: args.totalAmount ?? null,
    p_customer_name: args.customerName ?? null,
    p_customer_phone: args.customerPhone ?? null,
    p_screw_price: args.screwPrice ?? null,
    p_client_ref: args.clientRef ?? null,
  });
  if (isMissingFunctionError(error, 'pos_process_sale')) {
    rememberAvailability(false);
    return { unavailable: true };
  }
  if (!error) rememberAvailability(true);
  return { data, error };
}

/** Builds the arguments for processSaleAtomic from a checkout / offline-queue payload. */
export function saleArgsFromPayload(payload) {
  const screw = payload.screw_item;
  return {
    action: payload.p_action,
    location: payload.p_location,
    cashierName: payload.p_cashier_name,
    items: payload.p_items,
    paymentMethod: payload.p_payment_method,
    cashAmount: payload.p_cash_amount,
    upiAmount: payload.p_upi_amount,
    totalAmount: payload.p_total_amount ?? null,
    customerName: payload.p_customer_name,
    customerPhone: payload.p_customer_phone,
    screwPrice: (payload.p_action === 'SALE' && screw) ? Number(screw.customPriceInput || screw.price || 0) : null,
    clientRef: payload.client_ref || null,
  };
}

/** Return / void in one database call. */
export async function returnItemsAtomic({ billId, items, voidAll, performedBy }) {
  const { data, error } = await supabase.rpc('pos_return_items', {
    p_bill_id: billId,
    p_items: items,
    p_void_all: Boolean(voidAll),
    p_performed_by: performedBy || 'Staff',
  });
  if (isMissingFunctionError(error, 'pos_return_items')) return { unavailable: true };
  return { data, error };
}

/** Scrap / open-box write-off in one database call (stock + audit log). */
export async function removeStockAtomic({ batchId, qty, location, allowOther, actionType, note, performedBy }) {
  const { data, error } = await supabase.rpc('pos_remove_stock', {
    p_batch_id: batchId,
    p_qty: qty,
    p_location: location,
    p_allow_other: Boolean(allowOther),
    p_action_type: actionType,
    p_note: note || null,
    p_performed_by: performedBy || 'Staff',
  });
  if (isMissingFunctionError(error, 'pos_remove_stock')) return { unavailable: true };
  return { data, error };
}
