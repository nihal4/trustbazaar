import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TbConfig } from '../../../../kernel/config/config';
import { TB_CONFIG } from '../../../../kernel/config/config.provider';
import { CREDENTIALS } from '../../../../kernel/http/policies';
import { Problem } from '../../../../kernel/http/problems';
import { csrfMatches } from '../csrf';
import { policyOf, requestOf } from './policy-of';

// 3. CsrfGuard (Unit 1 section 4.1; SEC-SES-04). For every state-changing method: the Origin header must be
// the site's own origin (PUBLIC_ORIGIN), and, when a session is present, X-CSRF-Token must equal the CSRF
// cookie and both must be the HMAC of this session id. Cross-site credentials (provider webhooks, payment
// redirects) are exempt: they are not browser requests from the site, and their own signature protects them.
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = requestOf(ctx);
    if (!STATE_CHANGING.has(req.method)) return true;
    const policy = policyOf(this.reflector, ctx);
    if (policy?.kind === 'credential' && CREDENTIALS[policy.credential].crossSite) return true;
    if (req.header('origin') !== this.config.publicOrigin) throw new Problem('csrf-failed');
    if (req.principal && req.tbCookies) {
      const ok = csrfMatches(
        this.config.secrets.csrfKey,
        req.principal.sessionId,
        req.header('x-csrf-token'),
        req.cookies?.[req.tbCookies.csrf],
      );
      if (!ok) throw new Problem('csrf-failed');
    }
    return true;
  }
}
