export type LoginMode = 'login' | 'register';

type RegistrationConfig = {
  has_users?: boolean;
  password_registration?: boolean;
  allow_registration?: boolean;
  setup_complete?: boolean;
};

/** Follow the backend's public registration policy; keep admin setup separate. */
export function canShowRegistration(config: RegistrationConfig | null | undefined, inviteValid = false): boolean {
  if (!config) return false;
  return config.has_users === false || inviteValid
    || (config.password_registration ?? config.allow_registration ?? false);
}

/** A shareable signup link uses the already-public /login route. */
export function requestedLoginMode(search: string): LoginMode {
  return new URLSearchParams(search).get('mode') === 'register' ? 'register' : 'login';
}
