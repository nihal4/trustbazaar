import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { signAccessToken } from '../security/access-token';
import { csrfToken } from '../security/csrf';
import { RateLimiter } from '../security/rate-limiter.service';
import type { IssuedCookies } from '../http/session-cookies';
import { AuditService } from './audit.service';
import { publish } from './outbox';

// Sessions and refresh rotation (Unit 1 section 6.2; SEC-SES-02, SEC-SES-05, FR-ACC-08, FR-NTF-06).
// A session row is the truth: the access token only names it. A refresh token is 256 random bits; the
// server keeps its SHA-256. Every refresh replaces it. Presenting a replaced token again within DV-4
// (10 s, another tab) gets 409 to retry; later, it means the token was stolen, and the session ends.
export const REUSE_GRACE_MS = 10_000; // DV-4
const sha256 = (s: string) => createHash('sha256').update(s).digest();
const randomToken = () => randomBytes(32).toString('base64url');
// TypeORM's PostgreSQL driver answers UPDATE/DELETE ... RETURNING with [rows, count], INSERT with rows.
const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) && Array.isArray(result[0]) && typeof result[1] === 'number' ? result[0] : result) as T[];

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  device: string | null;
  approxLocation: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export type RefreshResult = { kind: 'rotated'; cookies: IssuedCookies } | { kind: 'retry' };

interface CP01 {
  accessTokenMinutes: number;
}
interface CP02 {
  idleDays: number;
  absoluteDays: number;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly db: DataSource,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  private async limits() {
    const p = await this.params.current();
    const cp01 = p.get<CP01>('CP-01');
    const cp02 = p.get<CP02>('CP-02');
    return {
      accessMs: cp01.accessTokenMinutes * 60_000,
      idleMs: cp02.idleDays * 86_400_000,
      absoluteMs: cp02.absoluteDays * 86_400_000,
    };
  }

  private tokens(sessionId: string, userId: string, now: Date, accessMs: number) {
    return {
      accessToken: signAccessToken(this.config.keys.jwt, { sub: userId, sid: sessionId, pt: 'user' }, accessMs / 1000, now),
      csrfToken: csrfToken(this.config.secrets.csrfKey, sessionId),
    };
  }

  /** A new user session inside the caller's transaction: device, session row, first refresh token. */
  async create(m: EntityManager, userId: string, deviceKey: string | undefined, ctx: RequestContext): Promise<{ sessionId: string; cookies: IssuedCookies }> {
    const now = this.clock.now();
    const { accessMs, idleMs, absoluteMs } = await this.limits();

    // A known device carries its key in a cookie; anything else is a new device, announced (FR-NTF-06).
    let deviceId: string | undefined;
    let newDeviceKey: string | undefined;
    if (deviceKey) {
      const [d] = rowsOf<{ id: string }>(
        await m.query(
          `UPDATE identity.known_devices SET last_seen_at = $3 WHERE user_id = $1 AND device_key_hash = $2 RETURNING id`,
          [userId, sha256(deviceKey), now],
        ),
      );
      deviceId = d?.id;
    }
    if (!deviceId) {
      newDeviceKey = randomToken();
      const label = deviceLabel(ctx.userAgent);
      const [d] = await m.query(
        `INSERT INTO identity.known_devices (user_id, device_key_hash, label, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [userId, sha256(newDeviceKey), label, now],
      );
      deviceId = d.id;
      await publish(m, 'identity.signin.new_device', userId, { userId, device: label, at: now.toISOString() });
    }

    const absolute = new Date(now.getTime() + absoluteMs);
    const idle = new Date(Math.min(now.getTime() + idleMs, absolute.getTime()));
    const [s] = await m.query(
      `INSERT INTO identity.sessions (principal_type, user_id, device_id, user_agent, first_ip, created_at, last_seen_at,
                                      idle_expires_at, absolute_expires_at)
       VALUES ('user', $1, $2, $3, $4, $5, $5, $6, $7) RETURNING id`,
      [userId, deviceId, ctx.userAgent?.slice(0, 300) ?? null, ctx.ip, now, idle, absolute],
    );
    const refreshToken = randomToken();
    await m.query(`INSERT INTO identity.refresh_tokens (session_id, token_hash, issued_at) VALUES ($1, $2, $3)`, [
      s.id, sha256(refreshToken), now,
    ]);
    return {
      sessionId: s.id,
      cookies: {
        ...this.tokens(s.id, userId, now, accessMs),
        refreshToken,
        accessMaxAgeMs: accessMs,
        refreshMaxAgeMs: absoluteMs,
        deviceKey: newDeviceKey,
      },
    };
  }

  /** Rotates a refresh token (SEC-SES-02). Throws 401 for an unknown, ended or expired session. */
  async refresh(raw: string | undefined, ctx: RequestContext): Promise<RefreshResult> {
    if (!raw) throw new Problem('session-ended');
    const now = this.clock.now();
    const { accessMs, idleMs } = await this.limits();
    return this.db.transaction(async (m) => {
      const [row] = await m.query(
        `SELECT rt.id, rt.used_at, s.id AS session_id, s.principal_type, s.user_id, s.ended_at, s.idle_expires_at,
                s.absolute_expires_at, u.account_status
         FROM identity.refresh_tokens rt
         JOIN identity.sessions s ON s.id = rt.session_id
         LEFT JOIN identity.users u ON u.id = s.user_id
         WHERE rt.token_hash = $1
         FOR UPDATE OF rt, s`,
        [sha256(raw)],
      );
      // Staff sessions refresh on their own path (U1-07, I-51).
      if (!row || row.principal_type !== 'user') throw new Problem('session-ended');
      const live =
        row.ended_at === null && now < row.idle_expires_at && now < row.absolute_expires_at && row.account_status !== 'closed';
      if (!live) throw new Problem('session-ended');

      if (row.used_at !== null) {
        if (now.getTime() - new Date(row.used_at).getTime() < REUSE_GRACE_MS) return { kind: 'retry' } as const;
        // A replaced token presented again after the grace window: it was copied. End the whole session.
        await this.endIn(m, row.session_id, 'refresh_reuse', row.user_id, ctx);
        await publish(m, 'identity.session.reuse_detected', row.user_id, { userId: row.user_id, sessionId: row.session_id });
        return { kind: 'reused' } as const;
      }

      const r = await this.limiter.hit(`rl:refresh:session:${row.session_id}`, 60, 3600);
      if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });

      const next = randomToken();
      const nextId = randomUUID();
      // Mark the old token first: only one unused token per session may exist (refresh_one_live);
      // replaced_by is checked at commit (a deferrable foreign key).
      await m.query(`UPDATE identity.refresh_tokens SET used_at = $2, replaced_by = $3 WHERE id = $1`, [row.id, now, nextId]);
      await m.query(`INSERT INTO identity.refresh_tokens (id, session_id, token_hash, issued_at) VALUES ($1, $2, $3, $4)`, [
        nextId, row.session_id, sha256(next), now,
      ]);
      const absolute = new Date(row.absolute_expires_at);
      const idle = new Date(Math.min(now.getTime() + idleMs, absolute.getTime()));
      await m.query(`UPDATE identity.sessions SET idle_expires_at = $2, last_seen_at = $3 WHERE id = $1`, [row.session_id, idle, now]);
      return {
        kind: 'rotated',
        cookies: {
          ...this.tokens(row.session_id, row.user_id, now, accessMs),
          refreshToken: next,
          accessMaxAgeMs: accessMs,
          refreshMaxAgeMs: absolute.getTime() - now.getTime(),
        },
      } as const;
    }).then((r) => {
      // Reuse is reported after the transaction committed, so the session stays ended.
      if (r.kind === 'reused') throw new Problem('session-ended');
      return r;
    });
  }

  private async endIn(m: EntityManager, sessionId: string, reason: string, userId: string, ctx: RequestContext): Promise<boolean> {
    const ended = await m.query(
      `UPDATE identity.sessions SET ended_at = $2, end_reason = $3 WHERE id = $1 AND ended_at IS NULL RETURNING id`,
      [sessionId, this.clock.now(), reason],
    );
    if (rowsOf(ended).length === 0) return false;
    await this.audit.record(m, {
      actorType: 'user', actorId: userId, action: 'identity.session.ended', objectType: 'session', objectId: sessionId,
      reason, sourceIp: ctx.ip, correlationId: ctx.correlationId,
    });
    return true;
  }

  /** Ends one of the user's own sessions (SEC-SES-05). False if it is not theirs or already ended. */
  async end(userId: string, sessionId: string, reason: 'logout' | 'user_ended', ctx: RequestContext): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const [own] = await m.query(`SELECT 1 FROM identity.sessions WHERE id = $1 AND user_id = $2 FOR UPDATE`, [sessionId, userId]);
      return own ? this.endIn(m, sessionId, reason, userId, ctx) : false;
    });
  }

  /** Ends every other live session of the user (FR-ACC-08); returns how many. */
  async endOthers(userId: string, keep: string, ctx: RequestContext): Promise<number> {
    return this.db.transaction(async (m) => {
      const others: { id: string }[] = await m.query(
        `SELECT id FROM identity.sessions WHERE user_id = $1 AND id <> $2 AND ended_at IS NULL FOR UPDATE`,
        [userId, keep],
      );
      let n = 0;
      for (const o of others) if (await this.endIn(m, o.id, 'user_ended', userId, ctx)) n++;
      return n;
    });
  }

  /** The user's live sessions, newest activity first (FR-ACC-08). */
  async list(userId: string, current: string): Promise<SessionSummary[]> {
    const now = this.clock.now();
    const rows = await this.db.query(
      `SELECT s.id, s.approx_location, s.created_at, s.last_seen_at, d.label
       FROM identity.sessions s LEFT JOIN identity.known_devices d ON d.id = s.device_id
       WHERE s.user_id = $1 AND s.ended_at IS NULL AND s.idle_expires_at > $2 AND s.absolute_expires_at > $2
       ORDER BY s.last_seen_at DESC`,
      [userId, now],
    );
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      current: r.id === current,
      device: (r.label as string | null) ?? null,
      approxLocation: (r.approx_location as string | null) ?? null,
      createdAt: r.created_at as Date,
      lastSeenAt: r.last_seen_at as Date,
    }));
  }
}

/** "Chrome on Android" from a user agent, for the session list; never the full string. */
export function deviceLabel(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  if (!browser && !os) return 'Unknown device';
  return [browser, os].filter(Boolean).join(' on ');
}
