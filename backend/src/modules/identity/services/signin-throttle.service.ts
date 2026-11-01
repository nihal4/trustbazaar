import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';

// Sign-in throttling (SEC-AUTH-04, CP-04, DV-10), for users and staff. Keyed by a hash of the normalised
// login, never the account id, so an unknown login is throttled exactly like a real one (SEC-AUTH-05).
// After CP-04 failures the next attempt must wait 1 s, doubling up to 15 minutes; a success or a password
// reset clears the count. If Redis is unavailable, the per-address limit and the audit log still apply.
const MAX_DELAY_SECONDS = 15 * 60; // DV-10

interface CP04 {
  failuresPerAccount: number;
  windowMinutes: number;
}

/** The Redis key of the CP-04 failure count for a normalised login (users: E.164 or e-mail; staff: "staff:" + e-mail). */
export const signInThrottleKey = (login: string) => `signin:fail:${createHash('sha256').update(login).digest('hex')}`;

@Injectable()
export class SignInThrottle {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  /** Throws 429 with Retry-After while the login must wait. */
  async check(login: string): Promise<void> {
    const now = this.clock.now().getTime();
    const until = Number(await this.redis.hget(signInThrottleKey(login), 'until').catch(() => null));
    if (until > now) throw new Problem('rate-limited', { retryAfter: Math.ceil((until - now) / 1000) });
  }

  /** Counts a failure; true when this failure starts the delay (the owner is told once). */
  async failed(login: string): Promise<boolean> {
    const key = signInThrottleKey(login);
    const cp04 = (await this.params.current()).get<CP04>('CP-04');
    const now = this.clock.now().getTime();
    try {
      const count = await this.redis.hincrby(key, 'count', 1);
      if (count === 1) await this.redis.expire(key, cp04.windowMinutes * 60);
      if (count < cp04.failuresPerAccount) return false;
      const delay = Math.min(2 ** (count - cp04.failuresPerAccount), MAX_DELAY_SECONDS);
      await this.redis.hset(key, 'until', String(now + delay * 1000));
      await this.redis.expire(key, Math.max(cp04.windowMinutes * 60, delay));
      return count === cp04.failuresPerAccount;
    } catch {
      return false;
    }
  }

  async clear(...logins: string[]): Promise<void> {
    await this.redis.del(...logins.map(signInThrottleKey)).catch(() => undefined);
  }
}
