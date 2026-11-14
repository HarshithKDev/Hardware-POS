import { createClient } from '@supabase/supabase-js'
import { readStoredSession } from './services/authSession'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase environment variables. Please check your .env file.");
}

// When the 1-hour access token has expired and could not be refreshed yet (phone just woke up,
// weak signal, offline), the Supabase library sends data requests as a signed-out visitor.
// The database's security rules then return no rows, which showed up as "everything is 0" on
// the dashboard. Instead: if this device has a saved login, try to refresh it once more, and if
// that still fails, report a network error so the app treats it as offline, never as empty data.
let pendingSessionCheck = null;
const authAwareFetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  const isDataRequest = url.includes('/rest/v1/') || url.includes('/storage/v1/');
  if (isDataRequest && init?.headers) {
    const headers = new Headers(init.headers);
    const signedOutRequest = headers.get('Authorization') === `Bearer ${supabaseKey}`;
    if (signedOutRequest && readStoredSession(supabase.auth.storageKey)) {
      pendingSessionCheck ||= supabase.auth.getSession().finally(() => { pendingSessionCheck = null; });
      const { data } = await pendingSessionCheck;
      const token = data?.session?.access_token;
      if (!token) {
        try { window.dispatchEvent(new Event('pos_auth_unreachable')); } catch { /* not in a browser */ }
        throw new TypeError('Failed to fetch: could not refresh the sign-in (no connection?)');
      }
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(input, { ...init, headers });
    }
  }
  return fetch(input, init);
};

// Primary connection tunnel
export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: authAwareFetch },
})

// Secondary client specifically for the owner to provision workers without logging out
export const provisioningClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'supabase.provisioning.auth.token'
  }
});
