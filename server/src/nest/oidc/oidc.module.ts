import { AppSettings } from '../../db/entities/AppSettings.entity';
import { InviteTokens } from '../../db/entities/InviteTokens.entity';
import { Users } from '../../db/entities/Users.entity';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TripMembershipModule } from '../trip-membership/trip-membership.module';
import { InMemoryOidcFlowStore, OidcFlowStore } from './oidc-flow.store';
import { AdminOidcController, OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { SupabaseAuthService } from './supabase-auth.service';
import { SupabaseAuthController } from './supabase-auth.controller';
import { RateLimitModule } from '../common/rate-limit.module';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    AuthModule,
    TripMembershipModule,
    AuditModule,
    RateLimitModule,
    MikroOrmModule.forFeature([Users, InviteTokens, AppSettings]),
  ],
  controllers: [OidcController, AdminOidcController, SupabaseAuthController],
  // The login states and codes stay in this process's memory; a store shared
  // between processes would be provided here instead.
  providers: [OidcService, SupabaseAuthService, { provide: OidcFlowStore, useClass: InMemoryOidcFlowStore }],
  // The AI assistant checks a ChatGPT sign-in's ID token with the same verifier.
  exports: [OidcService],
})
export class OidcModule {}
