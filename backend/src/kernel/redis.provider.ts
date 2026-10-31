import { Logger, Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { TbConfig } from './config/config';
import { TB_CONFIG } from './config/config.provider';

// The kernel's Redis client (docs/design/09_integration.pdf, section 4.4 lists its keys). One client per
// process; units reach it through the kernel.
export const REDIS = Symbol('REDIS');

export const redisProvider: Provider = {
  provide: REDIS,
  inject: [TB_CONFIG],
  useFactory: (cfg: TbConfig): Redis => {
    // A command fails after one retry instead of waiting for a reconnect, so readiness reports a
    // lost Redis promptly; the client keeps reconnecting in the background.
    const redis = new Redis(cfg.redisUrl.reveal(), { maxRetriesPerRequest: 1 });
    const log = new Logger('Redis');
    redis.on('error', (err: Error) => log.warn(`connection: ${err.message}`));
    return redis;
  },
};
