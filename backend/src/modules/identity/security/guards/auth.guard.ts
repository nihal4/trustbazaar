import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Problem } from '../../../../kernel/http/problems';
import { cookiesFor } from '../cookies';
import { SessionAuthenticator } from '../session-auth';
import { policyOf, requestOf } from './policy-of';

// 2. AuthGuard (Unit 1 section 4.1; SEC-SES-01, SEC-SES-05). The session check itself is SessionAuthenticator's,
// shared with the WebSocket handshake (K-07). Public routes run as guest when there is no valid session; every
// other route answers 401.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionAuthenticator,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policy = policyOf(this.reflector, ctx);
    if (!policy || policy.kind === 'credential') return true; // PolicyGuard refuses a missing policy
    const req = requestOf(ctx);
    const cookies = cookiesFor(policy);
    req.tbCookies = cookies;
    const token = req.cookies?.[cookies.access];
    const principal = await this.sessions.authenticate(typeof token === 'string' ? token : undefined, policy.kind === 'staff' ? 'staff' : 'user');
    if (principal === null || principal === 'expired') {
      if (policy.kind === 'public') return true; // guests
      throw new Problem('session-ended');
    }
    req.principal = principal;
    return true;
  }
}
