import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import type { StaffRoleName } from '../../../kernel/http/policies';
import type { Principal } from '../../../kernel/http/principal';
import { accessTokenStatus } from './access-token';

// The session check of Unit 1 section 4.1, shared by AuthGuard (HTTP) and the WebSocket handshake (SEC-SES-07),
// so both apply exactly the same rules. The token only names the session: the session row and the principal's
// status are loaded in one indexed query, and an ended session, one past its idle or absolute limit, or a closed
// or disabled account is refused. last_seen_at is updated at most once a minute.
const SESSION = `
  SELECT s.principal_type, s.user_id, s.staff_id, s.ended_at, s.idle_expires_at, s.absolute_expires_at,
         s.last_seen_at, u.account_status, u.kyc_status, u.email_verified_at IS NOT NULL AS email_verified,
         st.role AS staff_role, st.status AS staff_status
  FROM identity.sessions s
  LEFT JOIN identity.users u ON u.id = s.user_id
  LEFT JOIN identity.staff_accounts st ON st.id = s.staff_id
  WHERE s.id = $1`;

/** The sessions among `ids` that are still live (for the gateway's periodic re-check). */
const LIVE = `
  SELECT s.id FROM identity.sessions s
  LEFT JOIN identity.users u ON u.id = s.user_id
  LEFT JOIN identity.staff_accounts st ON st.id = s.staff_id
  WHERE s.id = ANY($1::uuid[]) AND s.ended_at IS NULL AND $2 < s.idle_expires_at AND $2 < s.absolute_expires_at
    AND CASE s.principal_type WHEN 'user' THEN u.account_status IN ('active', 'suspended') ELSE st.status = 'active' END`;

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

export type SessionCheck = Principal | 'expired' | null;

@Injectable()
export class SessionAuthenticator {
  constructor(
    private readonly db: DataSource,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The principal of a live session; 'expired' for a well-signed token past its expiry; else null. */
  async authenticate(token: string | undefined, expectedType: 'user' | 'staff'): Promise<SessionCheck> {
    if (typeof token !== 'string' || token === '') return null;
    const now = this.clock.now();
    const claims = accessTokenStatus(this.config.keys.jwt, token, now);
    if (claims === 'invalid') return null;
    if (claims === 'expired') return 'expired';
    if (claims.pt !== expectedType) return null;

    const [s] = (await this.db.query(SESSION, [claims.sid])) as SessionRow[];
    const subjectId = s && (s.principal_type === 'user' ? s.user_id : s.staff_id);
    const live =
      s !== undefined &&
      s.principal_type === claims.pt &&
      subjectId === claims.sub &&
      s.ended_at === null &&
      now < s.idle_expires_at &&
      now < s.absolute_expires_at &&
      (s.principal_type === 'user' ? s.account_status === 'active' || s.account_status === 'suspended' : s.staff_status === 'active');
    if (!live) return null;

    if (now.getTime() - s.last_seen_at.getTime() >= 60_000) {
      await this.db.query(
        `UPDATE identity.sessions SET last_seen_at = $2 WHERE id = $1 AND last_seen_at < $2::timestamptz - interval '1 minute'`,
        [claims.sid, now],
      );
    }
    return s.principal_type === 'user'
      ? {
          type: 'user', userId: s.user_id!, sessionId: claims.sid, accountStatus: s.account_status as 'active' | 'suspended',
          kycStatus: s.kyc_status!, emailVerified: s.email_verified === true,
        }
      : { type: 'staff', staffId: s.staff_id!, sessionId: claims.sid, role: s.staff_role! };
  }

  async liveSessions(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = (await this.db.query(LIVE, [ids, this.clock.now()])) as { id: string }[];
    return new Set(rows.map((r) => r.id));
  }
}
