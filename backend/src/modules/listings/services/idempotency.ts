import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import { Problem } from '../../../kernel/http/problems';
import { REDIS } from '../../../kernel/redis.provider';

// Idempotency-Key on POST /listings (I-53; Unit 8 section "Sent once"). Kept in Redis for 24 hours, per
// user (Decisions log, U3-02): the first request claims the key, and once it succeeds the key names the
// listing it created, so a repeat answers with that listing instead of creating a second one. A repeat
// while the first is still running is refused with request-in-progress; a failed request frees the key.
// If Redis cannot be reached the request goes ahead without the key: a duplicate draft is harmless and
// can be discarded, and Redis holds only reconstructible data (NFR-REL-01).
export const KEY_FORMAT = /^[A-Za-z0-9_-]{8,100}$/;
const TTL_SECONDS = 24 * 60 * 60;
const PENDING = 'pending';

@Injectable()
export class IdempotencyKeys {
  private readonly log = new Logger('IdempotencyKeys');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Runs create once per (user, key); a repeat returns the id the first run produced. */
  async once(scope: string, userId: string, key: string | undefined, create: () => Promise<string>): Promise<{ id: string; repeated: boolean }> {
    if (key === undefined) return { id: await create(), repeated: false };
    if (!KEY_FORMAT.test(key)) throw new Problem('validation-failed', { errors: [{ field: 'Idempotency-Key', reason: 'format' }] });
    const name = `idem:${scope}:${userId}:${createHash('sha256').update(key).digest('base64url')}`;
    let claimed: boolean;
    try {
      claimed = (await this.redis.set(name, PENDING, 'EX', TTL_SECONDS, 'NX')) === 'OK';
      if (!claimed) {
        const id = await this.redis.get(name);
        if (id === PENDING) throw new Problem('request-in-progress', { retryAfter: 1 });
        if (id) return { id, repeated: true };
        claimed = (await this.redis.set(name, PENDING, 'EX', TTL_SECONDS, 'NX')) === 'OK'; // expired in between
        if (!claimed) throw new Problem('request-in-progress', { retryAfter: 1 });
      }
    } catch (err) {
      if (err instanceof Problem) throw err;
      this.log.warn(`idempotency keys unavailable, request goes ahead: ${(err as Error).message}`);
      return { id: await create(), repeated: false };
    }
    try {
      const id = await create();
      await this.redis.set(name, id, 'EX', TTL_SECONDS).catch(() => undefined);
      return { id, repeated: false };
    } catch (err) {
      await this.redis.del(name).catch(() => undefined);
      throw err;
    }
  }
}
