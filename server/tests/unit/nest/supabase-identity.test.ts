import { verifySupabaseIdentity } from '../../../src/nest/oidc/supabase-identity';

import { describe, it, expect, vi } from 'vitest';

const url = 'https://wfabehnihelxemztmvca.supabase.co';
const sub = '11111111-1111-4111-8111-111111111111';
const claims = {
  iss: `${url}/auth/v1`,
  aud: 'authenticated',
  sub,
  exp: Math.floor(Date.now() / 1000) + 3600,
  aal: 'aal1',
};
const user = {
  id: sub,
  email: 'person@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { username: 'person', role: 'admin' },
};
const token = (extra = {}) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ ...claims, ...extra })).toString('base64url')}.signature`;
const verifier = (body: unknown = user, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('Supabase identity boundary', () => {
  it('verifies with the configured project and returns identity without trusting roles', async () => {
    const request = verifier();
    const identity = await verifySupabaseIdentity(url, 'public-key', token(), request);
    expect(identity).toMatchObject({ sub, email: user.email, name: 'person' });
    expect(identity).not.toHaveProperty('role');
    expect(request).toHaveBeenCalledWith(`${url}/auth/v1/user`, expect.objectContaining({ redirect: 'error' }));
  });
  it('refuses foreign-project and expired tokens before sending a credential anywhere', async () => {
    const request = verifier();
    await expect(
      verifySupabaseIdentity(url, 'key', token({ iss: 'https://foreign.supabase.co/auth/v1' }), request),
    ).rejects.toMatchObject({ status: 401 });
    await expect(verifySupabaseIdentity(url, 'key', token({ exp: 1 }), request)).rejects.toMatchObject({ status: 401 });
    expect(request).not.toHaveBeenCalled();
  });
  it('never accepts a decoded JWT when the provider rejects its signature', async () => {
    await expect(verifySupabaseIdentity(url, 'key', token(), verifier({}, 401))).rejects.toMatchObject({ status: 401 });
  });
  it('rejects a user response for another subject, anonymous users and unconfirmed email', async () => {
    for (const extra of [{ id: 'other' }, { is_anonymous: true }, { email_confirmed_at: null }]) {
      await expect(verifySupabaseIdentity(url, 'key', token(), verifier({ ...user, ...extra }))).rejects.toMatchObject({
        status: 401,
      });
    }
  });
  it('requires provider MFA for an account with an active factor', async () => {
    const secured = { ...user, factors: [{ status: 'verified' }] };
    await expect(verifySupabaseIdentity(url, 'key', token(), verifier(secured))).rejects.toMatchObject({ status: 401 });
    await expect(verifySupabaseIdentity(url, 'key', token({ aal: 'aal2' }), verifier(secured))).resolves.toHaveProperty(
      'sub',
      sub,
    );
  });
  it('refuses an arbitrary configured endpoint and oversized responses', async () => {
    const request = verifier();
    await expect(verifySupabaseIdentity('https://example.com', 'key', token(), request)).rejects.toMatchObject({
      status: 503,
    });
    expect(request).not.toHaveBeenCalled();
    await expect(
      verifySupabaseIdentity(url, 'key', token(), verifier({ ...user, padding: 'x'.repeat(256001) })),
    ).rejects.toMatchObject({ status: 401 });
  });
});
