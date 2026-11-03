import { getAppUrl } from '../../app-config';
import { AuditService } from '../audit/audit.service';
import { Public } from '../auth-core/public.decorator';
import { AuthService } from '../auth/auth.service';
import { DomainError } from '../common/domain-error';
import { RateLimitService } from '../common/rate-limit.service';
import { ResponseContract } from '../common/response-contract';
import { sessionClientFrom } from '../sessions/sessions.service';
import { SupabaseExchangeDto } from './supabase-auth.dto';
import { SupabaseAuthService } from './supabase-auth.service';
import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { supabaseExchangeResponseSchema, supabaseRevokeResponseSchema } from '@trek/shared';

import type { Request, Response } from 'express';

@Controller('api/auth/supabase')
export class SupabaseAuthController {
  constructor(
    private readonly supabase: SupabaseAuthService,
    private readonly auth: AuthService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  private async guard(req: Request, bucket: string) {
    if (
      !req.is('application/json') ||
      (req.get('origin') && req.get('origin') !== new URL(getAppUrl()).origin) ||
      req.get('sec-fetch-site') === 'cross-site'
    )
      throw new DomainError(403, 'A same-origin JSON request is required.');
    if (!(await this.limits.check(bucket, req.ip || 'unknown', 120, 15 * 60 * 1000, Date.now()))) {
      throw new DomainError(429, 'Too many attempts. Please try again later.');
    }
  }

  @Post('exchange')
  @Public('exchanges a server-verified Supabase account for a local session, including the local MFA challenge')
  @HttpCode(200)
  @ResponseContract(supabaseExchangeResponseSchema)
  async exchange(@Body() body: SupabaseExchangeDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.guard(req, 'supabase_exchange');
    const result = await this.supabase.exchange(
      body.access_token,
      body.remember_me === true,
      sessionClientFrom(req),
      body.invite_token,
    );
    if ('mfa_required' in result) return result;
    this.auth.setAuthCookie(res, result.token, req, result.remember);
    await this.audit.writeAudit({
      userId: result.auditUserId,
      action: 'user.login',
      ip: req.ip,
      details: { provider: 'supabase' },
    });
    return { success: true };
  }

  @Post('revoke')
  @Public('a verified provider identity can revoke only its own local sessions after password recovery')
  @HttpCode(200)
  @ResponseContract(supabaseRevokeResponseSchema)
  async revoke(@Body() body: SupabaseExchangeDto, @Req() req: Request) {
    await this.guard(req, 'supabase_revoke');
    return this.supabase.revoke(body.access_token);
  }
}
