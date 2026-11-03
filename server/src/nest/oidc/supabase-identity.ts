export interface SupabaseIdentity {
  sub: string;
  email: string;
  name: string;
  expiresAt: number;
}

export class SupabaseIdentityError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const fail = () => new SupabaseIdentityError(401, 'Unable to verify your Manzil account. Please sign in again.');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** getUser validates the signature/session at the fixed project; decoding alone is never authentication. */
export async function verifySupabaseIdentity(
  url: string,
  key: string,
  accessToken: unknown,
  request: typeof fetch = fetch,
): Promise<SupabaseIdentity> {
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url) || !key) {
    throw new SupabaseIdentityError(503, 'Manzil account sign-in is not configured.');
  }
  if (typeof accessToken !== 'string' || accessToken.length > 20000 || accessToken.split('.').length !== 3)
    throw fail();
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8'));
  } catch {
    throw fail();
  }
  if (
    !claims ||
    claims.iss !== `${url}/auth/v1` ||
    typeof claims.sub !== 'string' ||
    !uuid.test(claims.sub) ||
    typeof claims.exp !== 'number' ||
    claims.exp <= Date.now() / 1000 ||
    !(claims.aud === 'authenticated' || (Array.isArray(claims.aud) && claims.aud.includes('authenticated')))
  )
    throw fail();
  let response: Response;
  try {
    response = await request(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new SupabaseIdentityError(503, 'Account service is temporarily unavailable. Please try again.');
  }
  if (!response.ok) throw fail();
  if (!response.body || Number(response.headers.get('content-length') || 0) > 256000) throw fail();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 256000) {
      await reader.cancel();
      throw fail();
    }
    chunks.push(item.value);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let user: Record<string, unknown>;
  try {
    user = JSON.parse(text);
  } catch {
    throw fail();
  }
  if (
    !user ||
    user.id !== claims.sub ||
    user.is_anonymous === true ||
    !user.email_confirmed_at ||
    typeof user.email !== 'string' ||
    !user.email.includes('@') ||
    (typeof user.banned_until === 'string' && new Date(user.banned_until).getTime() > Date.now())
  )
    throw fail();
  const factors = Array.isArray(user.factors) ? (user.factors as Array<{ status?: string }>) : [];
  if (factors.some((factor) => factor.status === 'verified') && claims.aal !== 'aal2') {
    throw new SupabaseIdentityError(401, 'Complete your account two-factor verification before continuing.');
  }
  const metadata =
    user.user_metadata && typeof user.user_metadata === 'object' ? (user.user_metadata as Record<string, unknown>) : {};
  // Metadata is a display-name suggestion only, never a role or identity link.
  const name = typeof metadata.username === 'string' ? metadata.username : user.email.split('@')[0]!;
  return { sub: claims.sub, email: user.email.trim().toLowerCase(), name, expiresAt: claims.exp };
}
