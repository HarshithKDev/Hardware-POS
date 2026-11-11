import { supabase } from '../supabaseClient';
import { getPerformedBy } from '../utils';

/**
 * Writes one line to the audit log. Never throws and never blocks the action it records:
 * if the log can't be written (offline, permissions), the action still goes ahead.
 *
 * @param {object} entry
 * @param {string} entry.action   e.g. 'LOGIN', 'SETTINGS', 'CART CLEARED', 'PRINT', 'EXPORT'
 * @param {string} entry.changes  one readable sentence
 * @param {string} [entry.barcode]  item barcode, or '---' when not about an item
 * @param {string} [entry.itemName]
 * @param {string} [entry.performedBy]
 * @param {number} [entry.timeoutMs]  give up waiting after this long (default 2.5 s)
 */
export async function logActivity({ action, changes, barcode = '---', itemName, performedBy, timeoutMs = 2500 }) {
  try {
    const shopId = localStorage.getItem('shop_id');
    if (!shopId) return false;
    const insert = supabase.from('audit_logs').insert([{
      shop_id: shopId,
      action_type: action,
      barcode: barcode || '---',
      item_name: itemName || action.charAt(0) + action.slice(1).toLowerCase(),
      changes,
      performed_by: performedBy || getPerformedBy(),
    }]);
    const res = await Promise.race([
      insert,
      new Promise((resolve) => setTimeout(() => resolve({ error: { message: 'timeout' } }), timeoutMs)),
    ]);
    if (res?.error) console.warn('[Audit] could not log', action, res.error.message);
    return !res?.error;
  } catch (e) {
    console.warn('[Audit] could not log', action, e?.message);
    return false;
  }
}
