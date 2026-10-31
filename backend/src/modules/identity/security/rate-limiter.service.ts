import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../../kernel/redis.provider';

// Fixed-window counters in Redis, shared by every backend instance (Unit 1 section 5.4; key rl:{rule}:{subject}).
// One Lua script increments and sets the window atomically, so concurrent requests cannot both slip past
// the limit, and the counter can never be left without an expiry.
const HIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}`;

export interface HitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiter {
  private readonly log = new Logger('RateLimiter');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Counts one request against key's window. If Redis cannot be reached the request is allowed and the
   * failure logged: Redis holds only reconstructible data (NFR-REL-01), and the limits that guard secrets
   * (OTP attempts) are also enforced in PostgreSQL.
   */
  async hit(key: string, limit: number, windowSeconds: number): Promise<HitResult> {
    try {
      const [count, ttl] = (await this.redis.eval(HIT, 1, key, String(windowSeconds * 1000))) as [number, number];
      return { allowed: count <= limit, count, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) };
    } catch (err) {
      this.log.warn(`rate limiter unavailable, request allowed: ${(err as Error).message}`);
      return { allowed: true, count: 0, retryAfterSeconds: 0 };
    }
  }
}
