import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Problem } from '../../../../kernel/http/problems';
import { RESTRICTIONS, Restrictions } from '../restrictions';
import { policyOf, requestOf } from './policy-of';

// 4. PolicyGuard (Unit 1 section 4.1; DC-7). Enforces the route's declared policy. A route without one is
// unreachable, and the omission is logged as an error. Without a session: 401; with the wrong kind of
// principal or too little: 403. @Verified is the server-side KYC gate of FR-KYC-07: verified KYC, verified
// e-mail, an active (not suspended) account, and no restriction for the action.
@Injectable()
export class PolicyGuard implements CanActivate {
  private readonly log = new Logger('PolicyGuard');

  constructor(
    private readonly reflector: Reflector,
    @Inject(RESTRICTIONS) private readonly restrictions: Restrictions,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policy = policyOf(this.reflector, ctx);
    const req = requestOf(ctx);
    if (!policy) {
      this.log.error(`no policy on ${ctx.getClass().name}.${ctx.getHandler().name}: unreachable (DC-7)`);
      throw new Problem('forbidden');
    }
    const p = req.principal;
    switch (policy.kind) {
      case 'public':
      case 'credential':
        return true;
      case 'signed-in':
        if (!p) throw new Problem('session-ended');
        if (p.type !== 'user') throw new Problem('forbidden');
        return true;
      case 'verified': {
        if (!p) throw new Problem('session-ended');
        const ok =
          p.type === 'user' &&
          p.kycStatus === 'verified' &&
          p.emailVerified &&
          p.accountStatus === 'active' &&
          !(policy.action && (await this.restrictions.isRestricted(p.userId, policy.action)));
        if (!ok) throw new Problem('forbidden');
        return true;
      }
      case 'staff':
        if (!p) throw new Problem('session-ended');
        if (p.type !== 'staff' || (policy.roles.length > 0 && !policy.roles.includes(p.role))) throw new Problem('forbidden');
        return true;
    }
  }
}
