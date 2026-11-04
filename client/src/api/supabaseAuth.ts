import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  publishable_key: string;
}
export interface ExchangeResult {
  mfa_required?: boolean;
  mfa_token?: string;
}
const storageKey = 'manzil-supabase-session';
let client: SupabaseClient | null = null;
let clientProject = '';
const storage = {
  getItem(key: string) {
    return (localStorage.getItem('manzil-supabase-remember') === '1' ? localStorage : sessionStorage).getItem(key);
  },
  setItem(key: string, value: string) {
    (localStorage.getItem('manzil-supabase-remember') === '1' ? localStorage : sessionStorage).setItem(key, value);
  },
  removeItem(key: string) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export class SupabaseMfaRequired extends Error {
  constructor(public readonly factorId: string) {
    super('Enter your account authenticator code.');
  }
}

export function supabaseClient(config: SupabaseConfig): SupabaseClient {
  if (!client || clientProject !== config.url) {
    clientProject = config.url;
    client = createClient(config.url, config.publishable_key, {
      auth: { storage, storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

export async function availableSupabaseConfig(): Promise<SupabaseConfig | null> {
  const response = await fetch('/api/auth/app-config', { credentials: 'include', signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('Unable to load account configuration. Please try again.');
  return (await response.json()).supabase ?? null;
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/auth/supabase/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to finish account sign-in.');
  return data;
}

async function requireProviderMfa(config: SupabaseConfig) {
  const supabase = supabaseClient(config);
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
    const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
    if (factorError) throw factorError;
    const factor = factors.totp.find((value) => value.status === 'verified');
    if (!factor)
      throw new Error(
        'This account needs a verification method that is not available here. Use your identity provider to recover access.'
      );
    throw new SupabaseMfaRequired(factor.id);
  }
}

export async function exchangeSupabaseSession(
  config: SupabaseConfig,
  remember: boolean,
  inviteToken?: string
): Promise<ExchangeResult> {
  const supabase = supabaseClient(config);
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('Your sign-in link has expired. Please sign in again.');
  await requireProviderMfa(config);
  return post('exchange', {
    access_token: data.session.access_token,
    remember_me: remember,
    invite_token: inviteToken || undefined,
  });
}

export async function signInSupabase(
  config: SupabaseConfig,
  email: string,
  password: string,
  remember: boolean,
  inviteToken?: string
) {
  if (!remember) localStorage.removeItem(storageKey);
  localStorage.setItem('manzil-supabase-remember', remember ? '1' : '0');
  const { error } = await supabaseClient(config).auth.signInWithPassword({ email, password });
  if (error) throw error;
  return exchangeSupabaseSession(config, remember, inviteToken);
}

export async function signUpSupabase(
  config: SupabaseConfig,
  username: string,
  email: string,
  password: string,
  inviteToken?: string
) {
  localStorage.setItem('manzil-supabase-remember', '0');
  const target = new URL('/login', window.location.origin);
  target.searchParams.set('auth_callback', '1');
  if (inviteToken) target.searchParams.set('invite', inviteToken);
  const { data, error } = await supabaseClient(config).auth.signUp({
    email,
    password,
    options: { data: { username }, emailRedirectTo: target.href },
  });
  if (error) throw error;
  if (!data.session) return null;
  return exchangeSupabaseSession(config, false, inviteToken);
}

export async function verifySupabaseMfa(
  config: SupabaseConfig,
  factorId: string,
  code: string,
  remember: boolean,
  invite?: string
) {
  const { error } = await supabaseClient(config).auth.mfa.challengeAndVerify({
    factorId,
    code: code.replace(/\s/g, ''),
  });
  if (error) throw error;
  return exchangeSupabaseSession(config, remember, invite);
}

export async function signOutSupabase() {
  if (client)
    await Promise.race([
      client.auth.signOut({ scope: 'local' }).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  storage.removeItem(storageKey);
  storage.removeItem(`${storageKey}-code-verifier`);
}

export async function requestSupabaseReset(config: SupabaseConfig, email: string) {
  const { error } = await supabaseClient(config).auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password?auth=supabase`,
  });
  if (error) throw error;
}

export async function resetSupabasePassword(config: SupabaseConfig, password: string, mfaCode?: string) {
  const supabase = supabaseClient(config);
  try {
    await requireProviderMfa(config);
  } catch (error) {
    if (!(error instanceof SupabaseMfaRequired) || !mfaCode) throw error;
    const result = await supabase.auth.mfa.challengeAndVerify({
      factorId: error.factorId,
      code: mfaCode.replace(/\s/g, ''),
    });
    if (result.error) throw result.error;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('Your password reset link has expired. Request a new one.');
  const updated = await supabase.auth.updateUser({ password });
  if (updated.error) throw updated.error;
  const refreshed = await supabase.auth.getSession();
  await post('revoke', { access_token: refreshed.data.session?.access_token || data.session.access_token });
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  await signOutSupabase();
}
