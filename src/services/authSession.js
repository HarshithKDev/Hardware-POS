// Helpers for keeping the owner/staff signed in when the network is unreliable.
//
// Supabase keeps the login in localStorage: a short-lived access token (1 hour) and a refresh
// token used to get a new one. When the access token has expired and the refresh request fails
// because the phone just woke up, has a weak signal or is offline, the Supabase library reports
// "no session" even though the saved login is still perfectly valid. These helpers let the app
// tell "can't reach the server right now" apart from "really signed out".

import { isAuthRetryableFetchError } from '@supabase/supabase-js';

// "Remember me" on the login page. Ticked (the default): the sign-in is kept in localStorage and
// survives closing the browser. Not ticked: it is kept in sessionStorage only, so closing the
// browser really signs out (before, only the app's role was forgotten and the sign-in itself
// stayed on the device). Devices signed in before this change keep their sign-in as it was.
const PERSIST_KEY = 'pos_auth_persist';
const sessionOnly = () => {
  try { return localStorage.getItem(PERSIST_KEY) === '0'; } catch { return false; }
};

/** Call before signing in: true = stay signed in after the browser is closed. */
export function setAuthPersistence(remember) {
  try { localStorage.setItem(PERSIST_KEY, remember ? '1' : '0'); } catch { /* storage unavailable */ }
}

/** Where the Supabase library keeps the sign-in (see "Remember me" above). */
export const authStorage = {
  getItem(key) {
    try { return (sessionOnly() ? sessionStorage : localStorage).getItem(key); } catch { return null; }
  },
  setItem(key, value) {
    try {
      const [use, other] = sessionOnly() ? [sessionStorage, localStorage] : [localStorage, sessionStorage];
      use.setItem(key, value);
      other.removeItem(key); // never leave a copy in the other place
    } catch { /* storage full / unavailable */ }
  },
  removeItem(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    try { sessionStorage.removeItem(key); } catch { /* ignore */ }
  },
};

/** The login Supabase saved on this device ({ refresh_token, user, ... }), or null. */
export function readStoredSession(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = authStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Older library versions wrapped the session as { currentSession }
    const session = parsed?.currentSession || parsed;
    return session?.refresh_token ? session : null;
  } catch {
    return null;
  }
}

/** True when the sign-in could not be refreshed only because the server was unreachable. */
export function isTemporaryAuthFailure(error) {
  if (!error) return false;
  try {
    if (isAuthRetryableFetchError(error)) return true;
  } catch { /* older library: fall through */ }
  const msg = String(error.message || error);
  return /failed to fetch|networkerror|network request failed|load failed|timeout|timed out|abort/i.test(msg);
}
