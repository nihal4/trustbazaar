import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../../kernel/redis.provider';

// The courier circuit breaker (docs/design/04_delivery.pdf section 7.2; NFR-REL-04; U4-04). Shared by all instances
// through Redis: BREAKER.failures failed bookings in a row within BREAKER.window open it for BREAKER.open; while it is
// open, new courier quotes answer 503 courier-unavailable, and existing shipments keep retrying. A success closes it.
export const BREAKER = { failures: 5, windowSeconds: 600, openSeconds: 60 } as const;
const KEY = { failures: 'delivery:courier:failures', open: 'delivery:courier:open' };

@Injectable()
export class CourierBreaker {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async isOpen(): Promise<boolean> {
    return (await this.redis.exists(KEY.open)) === 1;
  }

  async failure(): Promise<void> {
    const n = await this.redis.incr(KEY.failures);
    if (n === 1) await this.redis.expire(KEY.failures, BREAKER.windowSeconds);
    if (n >= BREAKER.failures) await this.redis.set(KEY.open, '1', 'EX', BREAKER.openSeconds);
  }

  async success(): Promise<void> {
    await this.redis.del(KEY.failures, KEY.open);
  }
}
