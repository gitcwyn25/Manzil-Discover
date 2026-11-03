import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  requestSupabaseReset,
  resetSupabasePassword,
  signInSupabase,
  signOutSupabase,
  signUpSupabase,
  SupabaseMfaRequired,
} from './supabaseAuth';
const mocks = vi.hoisted(() => ({
  auth: {
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    getSession: vi.fn(),
    signOut: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    mfa: { getAuthenticatorAssuranceLevel: vi.fn(), listFactors: vi.fn(), challengeAndVerify: vi.fn() },
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: mocks.auth }) }));
const config = { url: 'https://wfabehnihelxemztmvca.supabase.co', publishable_key: 'public-test-key' };

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  mocks.auth.signInWithPassword.mockResolvedValue({ error: null });
  mocks.auth.getSession.mockResolvedValue({ data: { session: { access_token: 'verified-by-server' } }, error: null });
  mocks.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: 'aal1', nextLevel: 'aal1' },
    error: null,
  });
  mocks.auth.signOut.mockResolvedValue({ error: null });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
});

describe('Manzil Supabase account flow', () => {
  it('uses the local cookie exchange after provider login and preserves remember-me policy', async () => {
    await signInSupabase(config, 'member@example.com', 'test-password', true);
    expect(localStorage.getItem('manzil-supabase-remember')).toBe('1');
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/supabase/exchange',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        body: JSON.stringify({ access_token: 'verified-by-server', remember_me: true }),
      })
    );
  });
  it('requires provider MFA before requesting a local session', async () => {
    mocks.auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
      error: null,
    });
    mocks.auth.mfa.listFactors.mockResolvedValue({
      data: { totp: [{ id: 'factor', status: 'verified' }] },
      error: null,
    });
    await expect(signInSupabase(config, 'member@example.com', 'test-password', false)).rejects.toBeInstanceOf(
      SupabaseMfaRequired
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps unconfirmed registration signed out and returns confirmation to Discover', async () => {
    mocks.auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    expect(await signUpSupabase(config, 'Member', 'member@example.com', 'test-password', 'invite')).toBeNull();
    const redirect = new URL(mocks.auth.signUp.mock.calls[0][0].options.emailRedirectTo);
    expect(redirect.origin).toBe(window.location.origin);
    expect(redirect.pathname).toBe('/login');
    expect(redirect.searchParams.get('invite')).toBe('invite');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends password recovery back to the provider recovery page', async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await requestSupabaseReset(config, 'member@example.com');
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith('member@example.com', {
      redirectTo: `${window.location.origin}/reset-password?auth=supabase`,
    });
  });
  it('revokes local sessions after changing the provider password', async () => {
    mocks.auth.updateUser.mockResolvedValue({ error: null });
    await resetSupabasePassword(config, 'new-test-password');
    expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: 'new-test-password' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/supabase/revoke',
      expect.objectContaining({ method: 'POST', credentials: 'include' })
    );
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });
  it('clears persisted provider sessions on sign-out', async () => {
    localStorage.setItem('manzil-supabase-session', 'old-session');
    sessionStorage.setItem('manzil-supabase-session', 'old-session');
    await signOutSupabase();
    expect(localStorage.getItem('manzil-supabase-session')).toBeNull();
    expect(sessionStorage.getItem('manzil-supabase-session')).toBeNull();
  });
});
