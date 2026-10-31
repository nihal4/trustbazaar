import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../../kernel/clock';
import { TbConfig } from '../../../../kernel/config/config';
import { TB_CONFIG } from '../../../../kernel/config/config.provider';
import { Problem } from '../../../../kernel/http/problems';
import type { StaffRoleName } from '../../../../kernel/http/policies';
import { verifyAccessToken } from '../access-token';
import { cookiesFor } from '../cookies';
import { policyOf, requestOf } from './policy-of';

// 2. AuthGuard (Unit 1 section 4.1; SEC-SES-01, SEC-SES-05). Verifies the access-token cookie (HS256, known
// key id), then loads the session and the principal's status in one indexed query. A request is never
// authenticated by the token alone: an ended session, one past its idle or absolute limit, or a closed or
// disabled account is refused on its next request. Public routes run as guest when there is no valid
// session; every other route answers 401. last_seen_at is updated at most once a minute.
const SESSION = `
  SELECT s.principal_type, s.user_id, s.staff_id, s.ended_at, s.idle_expires_at, s.absolute_expires_at,
         s.last_seen_at, u.account_status, u.kyc_status, u.email_verified_at IS NOT NULL AS email_verified,
         st.role AS staff_role, st.status AS staff_status
  FROM identity.sessions s
  LEFT JOIN identity.users u ON u.id = s.user_id
  LEFT JOIN identity.staff_accounts st ON st.id = s.staff_id
  WHERE s.id = $1`;

interface SessionRow {
  principal_type: 'user' | 'staff';
  user_id: string | null;
  staff_id: string | null;
  ended_at: Date | null;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  last_seen_at: Date;
  account_status: 'active' | 'suspended' | 'closed' | null;
  kyc_status: string | null;
  email_verified: boolean | null;
  staff_role: StaffRoleName | null;
  staff_status: string | null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DataSource,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const policy = policyOf(this.reflector, ctx);
    if (!policy || policy.kind === 'credential') return true; // PolicyGuard refuses a missing policy
    const req = requestOf(ctx);
    const cookies = cookiesFor(policy);
    req.tbCookies = cookies;
    const optional = policy.kind === 'public';
    const refuse = () => {
      if (optional) return true;
      throw new Problem('session-ended');
    };

    const token = req.cookies?.[cookies.access];
    if (typeof token !== 'string') return refuse();
    const now = this.clock.now();
    const claims = verifyAccessToken(this.config.keys.jwt, token, now);
    const expectedType = policy.kind === 'staff' ? 'staff' : 'user';
    if (!claims || claims.pt !== expectedType) return refuse();

    const [s] = (await this.db.query(SESSION, [claims.sid])) as SessionRow[];
    const subjectId = s && (s.principal_type === 'user' ? s.user_id : s.staff_id);
    const live =
      s !== undefined &&
      s.principal_type === claims.pt &&
      subjectId === claims.sub &&
      s.ended_at === null &&
      now < s.idle_expires_at &&
      now < s.absolute_expires_at &&
      (s.principal_type === 'user'
        ? s.account_status === 'active' || s.account_status === 'suspended'
        : s.staff_status === 'active');
    if (!live) return refuse();

    req.principal =
      s.principal_type === 'user'
        ? {
            type: 'user',
            userId: s.user_id!,
            sessionId: claims.sid,
            accountStatus: s.account_status as 'active' | 'suspended',
            kycStatus: s.kyc_status!,
            emailVerified: s.email_verified === true,
          }
        : { type: 'staff', staffId: s.staff_id!, sessionId: claims.sid, role: s.staff_role! };

    if (now.getTime() - s.last_seen_at.getTime() >= 60_000) {
      await this.db.query(
        `UPDATE identity.sessions SET last_seen_at = $2 WHERE id = $1 AND last_seen_at < $2::timestamptz - interval '1 minute'`,
        [claims.sid, now],
      );
    }
    return true;
  }
}
