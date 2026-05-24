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
  const datePart = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  let hours = d.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const timePart = `${hours.toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} ${ampm}`;

  return { datePart, timePart, full: `${datePart}, ${timePart}` };
}
