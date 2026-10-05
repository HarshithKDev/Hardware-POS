// ---------------------------------------------------------------
// Shared utility functions
// ---------------------------------------------------------------

/**
 * Escapes Postgres ILIKE wildcards (% and _) in a user-provided string
 * so they are treated as literal characters in Supabase .ilike() filters.
 *
 * Without this, a user typing "%" matches everything (wildcard injection).
 *
 * @param {string} str - Raw user input
 * @returns {string} Escaped string safe for .ilike()
 */
export function escapeIlike(str) {
  if (!str) return str;
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Creates a debounced version of a function that delays invocation
 * until after `ms` milliseconds since the last call.
 *
 * @param {Function} fn - Function to debounce
 * @param {number} ms - Delay in milliseconds
 * @returns {Function} Debounced function with a .cancel() method
 */
export function debounce(fn, ms) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/**
 * Generates a unique ID using the browser's crypto API.
 * Falls back to a timestamp+random string for older environments.
 *
 * @returns {string} A unique identifier
 */
export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Formats a Date object or ISO date string into a human-readable
 * date + time string. Single source of truth replacing duplicated
 * formatDateTime implementations across WorkerTerminal and OwnerLedger.
 *
 * @param {Date|string} input - Date object or ISO string
 * @returns {{ datePart: string, timePart: string, full: string }}
 */
export function formatDateTime(input) {
  if (!input) return { datePart: '', timePart: '', full: '' };

  const d = input instanceof Date ? input : new Date(input);
  const day = String(d.getDate()).padStart(2, '0');
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = monthNames[d.getMonth()];
  const year = d.getFullYear();
  const datePart = `${day} ${month} ${year}`;

  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const timePart = `${hours.toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} ${ampm}`;

  return { datePart, timePart, full: `${datePart}, ${timePart}` };
}

/**
 * Calculates the true Minimum Selling Price (MSP) of an item/batch combo.
 * It gracefully falls back through available cost values if MSP is strictly zero or missing.
 * 
 * @param {Object} batch - The batch object (optional)
 * @param {Object} item - The master product object (optional)
 * @returns {number} The calculated MSP value
 */
export function calculateMSP(batch, item) {
  const bMsp = batch && !isNaN(Number(batch.msp)) ? Number(batch.msp) : 0;
  if (bMsp > 0) return bMsp;

  const bCost = batch && !isNaN(Number(batch.purchase_cost)) ? Number(batch.purchase_cost) : 0;
  if (bCost > 0) return bCost;

  const iMsp = item && !isNaN(Number(item.msp)) ? Number(item.msp) : 0;
  if (iMsp > 0) return iMsp;

  const iCost = item && !isNaN(Number(item.cost_price)) ? Number(item.cost_price) : 0;
  return iCost > 0 ? iCost : 0;
}
