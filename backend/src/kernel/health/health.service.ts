import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { REDIS } from '../redis.provider';

// DV-61: each dependency must answer within 2 seconds.
export const HEALTH_TIMEOUT_MS = 2000;

export type ProbeResult = 'up' | 'down';

// Runs one check; 'down' if it fails or does not answer within the timeout.
export async function probe(check: () => Promise<unknown>, timeoutMs = HEALTH_TIMEOUT_MS): Promise<ProbeResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<ProbeResult>((resolve) => {
    timer = setTimeout(() => resolve('down'), timeoutMs);
  });
  try {
    return await Promise.race([
      check().then(
        (): ProbeResult => 'up',
        (): ProbeResult => 'down',
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface Readiness {
  ready: boolean;
  postgres: ProbeResult;
  redis: ProbeResult;
}

// NFR-OBS-01 (docs/design/09_integration.pdf, section 5.2): ready = PostgreSQL answers SELECT 1 and
// Redis answers PING, each within 2 seconds. The two checks run in parallel.
@Injectable()
export class HealthService {
  private readonly log = new Logger('Health');

  constructor(
    private readonly db: DataSource,
    @Inject(REDIS) private readonly redis: Pick<Redis, 'ping'>,
  ) {}

  async readiness(): Promise<Readiness> {
    const [postgres, redis] = await Promise.all([
      probe(() => this.db.query('SELECT 1')),
      probe(() => this.redis.ping()),
    ]);
    const ready = postgres === 'up' && redis === 'up';
    if (!ready) this.log.warn(`not ready: postgres ${postgres}, redis ${redis}`);
    return { ready, postgres, redis };
  }
}
