// Helpers for keeping the owner/staff signed in when the network is unreliable.
//
// Supabase keeps the login in localStorage: a short-lived access token (1 hour) and a refresh
// token used to get a new one. When the access token has expired and the refresh request fails
// because the phone just woke up, has a weak signal or is offline, the Supabase library reports
// "no session" even though the saved login is still perfectly valid. These helpers let the app
// tell "can't reach the server right now" apart from "really signed out".

import { isAuthRetryableFetchError } from '@supabase/supabase-js';

/** The login Supabase saved on this device ({ refresh_token, user, ... }), or null. */
export function readStoredSession(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
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
