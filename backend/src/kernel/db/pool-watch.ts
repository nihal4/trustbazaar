// The database pool's watchdog (U11-11). A transaction holds one connection for its whole length; when every connection is held by a transaction that waits for a lock, and the one that holds
// the lock needs another connection, nothing moves: no error, no log, a request that never ends. This looks at the pool every few seconds and says so (a warning while requests wait with no
// free connection, an error once it has lasted a while), with the numbers, so a hang is no longer silent. With DB_CONNECT_TIMEOUT_MS the waiting request then fails instead of waiting for ever.
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** What the watchdog reads of a pg pool. */
export interface PoolStats {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

const POOL_CHECK_MS = 5_000;
/** consecutive checks with waiting requests and no free connection before it is an error */
export const POOL_STUCK_CHECKS = 3;

@Injectable()
export class PoolWatch implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PoolWatch');
  private timer: NodeJS.Timeout | undefined;
  private stuck = 0;

  constructor(private readonly db: DataSource) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.check(), POOL_CHECK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One look at the pool; returns whether it is stuck now (requests wait and no connection is free). */
  check(stats: PoolStats | undefined = (this.db.driver as unknown as { master?: PoolStats } | undefined)?.master): boolean {
    if (!stats) return false;
    const stuckNow = stats.waitingCount > 0 && stats.idleCount === 0;
    this.stuck = stuckNow ? this.stuck + 1 : 0;
    if (!stuckNow) return false;
    const numbers = `${stats.totalCount} connections, none free, ${stats.waitingCount} requests waiting`;
    if (this.stuck >= POOL_STUCK_CHECKS)
      this.log.error(`the database pool has been exhausted for ${this.stuck} checks: ${numbers}; transactions may be waiting for each other`);
    else this.log.warn(`the database pool is exhausted: ${numbers}`);
    return true;
  }
}
