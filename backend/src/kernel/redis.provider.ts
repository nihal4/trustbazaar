import { Logger, Provider } from '@nestjs/common';
import Redis from 'ioredis';

// The kernel's Redis client (docs/design/09_integration.pdf, section 4.4 lists its keys). One client per
// process; units reach it through the kernel. REDIS_URL comes from the environment until K-01 adds the
// configuration module.
export const REDIS = Symbol('REDIS');

export const redisProvider: Provider = {
  provide: REDIS,
  useFactory: (): Redis => {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is required');
    // A command fails after one retry instead of waiting for a reconnect, so readiness reports a
    // lost Redis promptly; the client keeps reconnecting in the background.
    const redis = new Redis(url, { maxRetriesPerRequest: 1 });
    const log = new Logger('Redis');
    redis.on('error', (err: Error) => log.warn(`connection: ${err.message}`));
    return redis;
  },
};
