import { getWorkerEmail, getLegacyWorkerEmail } from '../constants';

const norm = (v) => String(v || '').trim().toLowerCase();

/**
 * The role ("owner" or a staff name) is stored in localStorage/sessionStorage and can be
 * edited by anyone with devtools. This checks it against the email of the account that
 * actually authenticated with Supabase, so a staff login can't be turned into "owner"
 * (or into another staff member) by editing browser storage.
 *
 * @param {string} role        Stored role: 'owner' or a staff name.
 * @param {string} email       Email of the authenticated Supabase user.
 * @param {object} ctx
 * @param {string} ctx.adminEmail  The shop's owner email (from shop_settings).
 * @param {string} ctx.shopId      Current shop id.
 */
export function isRoleConsistentWithEmail(role, email, { adminEmail, shopId } = {}) {
  if (!role || !email) return false;
  const e = norm(email);

  if (role === 'owner') {
    return Boolean(adminEmail) && e === norm(adminEmail);
  }

  // Staff: same email derivation used at login (EntryFlow), including the legacy un-scoped format.
  return e === norm(getWorkerEmail(role, shopId)) || e === norm(getLegacyWorkerEmail(role));
}

/** True for errors that mean "couldn't reach the server" rather than "server said no". */
export function isNetworkishError(err) {
  if (!err) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(err.message || err);
  return /failed to fetch|networkerror|network request failed|load failed|timeout|timed out|abort/i.test(msg);
}
