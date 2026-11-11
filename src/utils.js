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

/**
 * Formats a YYYY-MM-DD date string into a friendly, human-readable display
 * with (Today) or (Yesterday) tags.
 *
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @returns {string} e.g. "Wed, 21 Oct 2026 (Today)"
 */
export function formatDayHeader(dateStr) {
  if (!dateStr) return '';
  try {
    const cleanStr = String(dateStr).split('T')[0];
    const parts = cleanStr.split('-').map(Number);
    if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
      return dateStr;
    }
    const [y, m, d] = parts;
    const dateObj = new Date(y, m - 1, d);
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('en-CA');

    const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
    const formatted = `${dateObj.getDate()} ${dateObj.toLocaleDateString('en-US', { month: 'short' })} ${dateObj.getFullYear()}`;

    return `${dayName}, ${formatted}`;
  } catch (e) {
    return dateStr;
  }
}

export { useSessionState } from './hooks/useSessionState';

/**
 * Name to record in audit logs for the current user. Previously every screen used the
 * owner's name from localStorage, so actions by staff on a shared device were logged
 * as the owner. The role is verified against the signed-in account at start-up.
 */
export function getPerformedBy() {
  let role = null;
  try {
    role = sessionStorage.getItem('posUserRole') || localStorage.getItem('posUserRole');
  } catch (e) { /* storage unavailable */ }
  if (!role || role === 'owner') {
    try { return localStorage.getItem('owner_name') || 'Owner'; } catch (e) { return 'Owner'; }
  }
  return role;
}

/**
 * Convert a local wall-clock string like "2026-11-10T00:00:00" into a UTC ISO timestamp.
 * Database timestamps are compared in UTC; sending the local string as-is made each
 * "day" in reports run from 05:30 to 05:29 IST instead of midnight to midnight.
 */
export function localToUtcIso(localDateTime) {
  const d = new Date(localDateTime); // no offset in the string → parsed as local time
  return isNaN(d.getTime()) ? localDateTime : d.toISOString();
}

/** Value for a price input: real prices are pre-filled, 0 / missing shows an empty box. */
export function priceInputValue(...candidates) {
  for (const v of candidates) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return String(v);
  }
  return '';
}

/**
 * Indian-style number formatting for money: 1,00,000.00 / 30,000.00 / 999.50
 * @param {number|string} value
 * @param {number} [decimals=2]
 */
export function formatINR(value, decimals = 2) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Bill reference shown to people: the sequential bill number, or (old/unnumbered bills) the short id. */
export function billLabel(bill) {
  if (!bill) return '';
  if (bill.bill_no !== undefined && bill.bill_no !== null && bill.bill_no !== '') return String(bill.bill_no);
  return String(bill.id || '').split('-')[0];
}
