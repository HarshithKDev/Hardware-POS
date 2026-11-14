// Staying signed in on a bad connection: an expired sign-in that can't be refreshed right now
// must never turn into "signed-out" data requests (which return nothing, so the dashboard
// showed 0) or send the owner back to the login page.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthRetryableFetchError, AuthApiError } from '@supabase/supabase-js';
import { readStoredSession, isTemporaryAuthFailure } from '../services/authSession';
import { supabase } from '../supabaseClient';
import { isNetworkishError } from '../services/roleGuard';

const KEY = 'sb-test-auth-token';

describe('saved login helpers', () => {
  beforeEach(() => localStorage.clear());

  it('reads the saved login only when it has a refresh token', () => {
    expect(readStoredSession(KEY)).toBeNull();
    localStorage.setItem(KEY, 'not json');
    expect(readStoredSession(KEY)).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ access_token: 'a' }));
    expect(readStoredSession(KEY)).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ refresh_token: 'r', user: { email: 'o@x.com' } }));
    expect(readStoredSession(KEY).user.email).toBe('o@x.com');
    localStorage.setItem(KEY, JSON.stringify({ currentSession: { refresh_token: 'r' } }));
    expect(readStoredSession(KEY).refresh_token).toBe('r');
    expect(readStoredSession(undefined)).toBeNull();
  });

  it('tells "server unreachable" apart from "really signed out"', () => {
    expect(isTemporaryAuthFailure(new AuthRetryableFetchError('Failed to fetch', 0))).toBe(true);
    expect(isTemporaryAuthFailure(new Error('Sign-in check timed out'))).toBe(true);
    expect(isTemporaryAuthFailure(new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'))).toBe(false);
    expect(isTemporaryAuthFailure(null)).toBe(false);
  });
});

describe('data requests while the sign-in cannot be refreshed', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async () => new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const authHeaderOf = (call) => new Headers(call[1].headers).get('Authorization');

  it('reports a network error instead of asking as a signed-out visitor (no more zeros)', async () => {
    localStorage.setItem(supabase.auth.storageKey, JSON.stringify({ refresh_token: 'r', user: { email: 'o@x.com' } }));
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    const unreachable = vi.fn();
    window.addEventListener('pos_auth_unreachable', unreachable);

    const { data, error } = await supabase.from('bills').select('*');

    window.removeEventListener('pos_auth_unreachable', unreachable);
    expect(data).toBeNull();
    expect(isNetworkishError(error)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(unreachable).toHaveBeenCalled();
  });

  it('uses the refreshed sign-in when the second try works', async () => {
    localStorage.setItem(supabase.auth.storageKey, JSON.stringify({ refresh_token: 'r', user: { email: 'o@x.com' } }));
    vi.spyOn(supabase.auth, 'getSession')
      .mockResolvedValueOnce({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
      .mockResolvedValue({ data: { session: { access_token: 'fresh-token' } }, error: null });

    const { error } = await supabase.from('bills').select('*');

    expect(error).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe('Bearer fresh-token');
  });

  it('leaves requests alone when nobody is signed in on this device', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({ data: { session: null }, error: null });

    const { error } = await supabase.from('shop_settings').select('*');

    expect(error).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe('Bearer test-anon-key');
  });
});
