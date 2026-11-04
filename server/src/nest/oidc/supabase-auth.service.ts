import { readEnv } from '../../app-config';
import { Users } from '../../db/entities/Users.entity';
import type { UsersRepository } from '../../db/repositories/Users.repository';
import { AuthService } from '../auth/auth.service';
import { DomainError } from '../common/domain-error';
import type { SessionClient } from '../sessions/sessions.service';
import { OidcService } from './oidc.service';
import { verifySupabaseIdentity, SupabaseIdentityError } from './supabase-identity';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

@Injectable()
export class SupabaseAuthService {
  constructor(
    private readonly auth: AuthService,
    private readonly oidc: OidcService,
    @InjectRepository(Users) private readonly users: UsersRepository,
  ) {}

  private async identity(accessToken: string) {
    const config = readEnv().supabase;
    try {
      return await verifySupabaseIdentity(config.url, config.publishableKey, accessToken);
    } catch (error) {
      if (error instanceof SupabaseIdentityError) throw new DomainError(error.status, error.message);
      throw new DomainError(401, 'Unable to verify your account. Please sign in again.');
    }
  }

  async exchange(accessToken: string, remember: boolean, client: SessionClient, inviteToken?: string) {
    if (!(await this.auth.resolveAuthToggles()).password_login) {
      throw new DomainError(403, 'Account password sign-in is disabled.');
    }
    const identity = await this.identity(accessToken);
    const issuer = `${readEnv().supabase.url}/auth/v1`;
    const mapped = await this.oidc.findOrCreateUser(
      { sub: identity.sub, email: identity.email, name: identity.name, email_verified: true },
      { issuer, clientId: 'manzil', clientSecret: '', displayName: 'Manzil account', discoveryUrl: null },
      inviteToken,
      'supabase',
    );
    if ('error' in mapped) {
      if (mapped.error === 'identity_link_required') {
        throw new DomainError(
          409,
          'This email already has a local account. Use its existing sign-in; accounts are not linked automatically.',
        );
      }
      if (mapped.error === 'registration_disabled') throw new DomainError(403, 'New account registration is disabled.');
      throw new DomainError(403, 'Account setup could not be completed. Contact the administrator.');
    }
    return this.auth.completeExternalLogin(Number(mapped.user.id), remember, client);
  }

  async revoke(accessToken: string) {
    const identity = await this.identity(accessToken);
    const user = await this.users.findByOidcIdentity(identity.sub, `${readEnv().supabase.url}/auth/v1`);
    if (user) await this.auth.revokeExternalSessions(Number(user.id));
    // Enumeration-safe for a provider account that has never entered this app.
    return { success: true };
  }
}
