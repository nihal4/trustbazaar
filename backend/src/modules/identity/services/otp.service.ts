import { Inject, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { hashOtp, otpMatches } from '../crypto/otp';
import { RateLimiter } from '../security/rate-limiter.service';

// SMS one-time codes for registration, step-up, password reset and a phone change (SEC-AUTH-09, CP-05;
// Unit 1 sections 5.4 and 6). Challenges live in identity.otp_challenges with the HMAC of the code; the
// database caps the attempts, so the limit holds even if Redis is lost. The newest matching challenge is
// the only valid one: asking again replaces the code.
export const RESEND_GAP_SECONDS = 60; // Decisions log (U1-03)
export const VERIFY_PER_HOUR = 20; // CP-05: code entries per account (or number, before an account) per hour

export interface CP05 {
  otpValidityMinutes: number;
  attemptsPerOtp: number;
  sendsPerNumberHour: number;
  sendsPerNumberDay: number;
}

export type OtpPurpose = 'register_phone' | 'step_up' | 'contact_change_phone' | 'password_reset';

export interface ChallengeSpec {
  purpose: OtpPurpose;
  phone: string;
  userId?: string | null;
  pendingRegistrationId?: string | null;
  boundTo?: string | null;
}

export type OtpOutcome = { kind: 'ok'; challengeId: string } | { kind: 'failed' | 'expired'; challengeId?: string };

@Injectable()
export class OtpService {
  constructor(
    private readonly limiter: RateLimiter,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  private get pepper(): string {
    return this.config.secrets.otpPepper.reveal();
  }

  async cp05(): Promise<CP05> {
    return (await this.params.current()).get<CP05>('CP-05');
  }

  /** CP-05 send limits per number (Redis otp:send:{phone}:h and :d) and the gap before the next send. */
  async countSend(phone: string): Promise<void> {
    const r = await this.trySend(phone);
    if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfter });
  }

  /** As countSend, but answers instead of throwing: for flows whose answer must not change (password reset). */
  async trySend(phone: string): Promise<{ allowed: boolean; retryAfter?: number }> {
    const cp05 = await this.cp05();
    const checks: [string, number, number][] = [
      [`otp:gap:${phone}`, 1, RESEND_GAP_SECONDS],
      [`otp:send:${phone}:h`, cp05.sendsPerNumberHour, 3600],
      [`otp:send:${phone}:d`, cp05.sendsPerNumberDay, 86400],
    ];
    for (const [key, limit, window] of checks) {
      const r = await this.limiter.hit(key, limit, window);
      if (!r.allowed) return { allowed: false, retryAfter: r.retryAfterSeconds };
    }
    return { allowed: true };
  }

  /** CP-05: at most VERIFY_PER_HOUR code entries per key (an account, or a number) per hour. */
  async countEntry(key: string): Promise<void> {
    const r = await this.limiter.hit(`rl:otp-verify:${key}`, VERIFY_PER_HOUR, 3600);
    if (!r.allowed) throw new Problem('rate-limited', { retryAfter: r.retryAfterSeconds });
  }

  /** Stores a new challenge for the code; returns when it expires. */
  async issue(m: EntityManager, spec: ChallengeSpec, code: string): Promise<Date> {
    const cp05 = await this.cp05();
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + cp05.otpValidityMinutes * 60_000);
    await m.query(
      `INSERT INTO identity.otp_challenges (purpose, user_id, pending_registration_id, phone_e164, code_hash, bound_to,
                                            max_attempts, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [spec.purpose, spec.userId ?? null, spec.pendingRegistrationId ?? null, spec.phone, hashOtp(this.pepper, code), spec.boundTo ?? null,
       cp05.attemptsPerOtp, now, expiresAt],
    );
    return expiresAt;
  }

  /**
   * Checks a code against the newest challenge matching `where` (SQL over the columns of otp_challenges,
   * with $1.. parameters), locking it. A wrong code counts an attempt; the right one uses the challenge up.
   * The caller's transaction must commit for either to stick.
   */
  async consume(m: EntityManager, where: string, params: unknown[], code: string): Promise<OtpOutcome> {
    const now = this.clock.now();
    const [ch] = await m.query(
      `SELECT id, code_hash, attempts, max_attempts, expires_at, consumed_at FROM identity.otp_challenges
       WHERE ${where} ORDER BY created_at DESC, id LIMIT 1 FOR UPDATE`,
      params,
    );
    if (!ch) return { kind: 'expired' };
    if (ch.consumed_at || new Date(ch.expires_at) <= now || ch.attempts >= ch.max_attempts) return { kind: 'expired', challengeId: ch.id };
    if (!otpMatches(this.pepper, code, ch.code_hash)) {
      await m.query(`UPDATE identity.otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id]);
      return { kind: 'failed', challengeId: ch.id };
    }
    await this.markUsed(m, ch.id);
    return { kind: 'ok', challengeId: ch.id };
  }

  async markUsed(m: EntityManager, challengeId: string): Promise<void> {
    await m.query(`UPDATE identity.otp_challenges SET consumed_at = $2 WHERE id = $1 AND consumed_at IS NULL`, [challengeId, this.clock.now()]);
  }
}
