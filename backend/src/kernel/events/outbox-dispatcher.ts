import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CLOCK, Clock } from '../clock';
import { EventBus, OutboxEvent } from './event-bus';

// The outbox dispatcher for all seven outboxes (DC-6, DV-67; docs/design/09_integration.pdf section 3.2).
// Every 5 seconds, plus up to 10% random spread so that instances do not run in step, it takes the due events
// of each outbox with FOR UPDATE SKIP LOCKED, so several instances never deliver the same row at the same
// time, and hands each event to the consumers registered for its name. The event is marked dispatched once
// all of them have returned. If any fails, the event is retried with a growing delay; after 10 attempts it
// is reported to the operators (an error log line; the metric and alert come with K-02 and K-06) and no
// longer retried. A slow or failing consumer never blocks the publisher, which committed long before.
// An event nobody consumes is marked dispatched at once.
export const OUTBOXES = ['identity', 'orders', 'auctions', 'delivery', 'game_accounts', 'chat', 'disputes'] as const;
export const POLL_MS = 5_000; // DV-67
export const MAX_ATTEMPTS = 10; // DV-67
const BATCH = 100;

/** The delay before attempt n+1 after n failed attempts: 5 s doubling, at most one hour. */
export const retryDelayMs = (failedAttempts: number) => Math.min(5_000 * 2 ** (failedAttempts - 1), 3_600_000);

export interface DrainResult {
  dispatched: number;
  failed: number;
  givenUp: number;
}

@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('OutboxDispatcher');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = false;

  constructor(
    private readonly db: DataSource,
    private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.OUTBOX_DISPATCHER === 'off') return; // tests that drain by hand
    this.schedule();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running?.catch(() => undefined);
  }

  private schedule(): void {
    if (this.stopped) return;
    const delay = POLL_MS + Math.random() * POLL_MS * 0.1;
    this.timer = setTimeout(() => {
      this.running = this.drain()
        .catch((e: unknown) => this.log.error(`outbox poll failed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => this.schedule());
    }, delay);
    this.timer.unref();
  }

  /** One pass over every outbox; also used by tests. */
  async drain(): Promise<DrainResult> {
    const total: DrainResult = { dispatched: 0, failed: 0, givenUp: 0 };
    for (const outbox of OUTBOXES) {
      const r = await this.drainOne(outbox);
      total.dispatched += r.dispatched;
      total.failed += r.failed;
      total.givenUp += r.givenUp;
    }
    return total;
  }

  private drainOne(outbox: (typeof OUTBOXES)[number]): Promise<DrainResult> {
    // The table name comes from the fixed list above, never from input.
    const table = `${outbox}.outbox`;
    return this.db.transaction(async (m) => {
      const now = this.clock.now();
      const rows: { id: string; event_type: string; aggregate_id: string; payload: Record<string, unknown>; created_at: Date; attempts: number }[] =
        await m.query(
          `SELECT id::text, event_type, aggregate_id, payload, created_at, attempts FROM ${table}
           WHERE dispatched_at IS NULL AND next_attempt_at <= $1 AND attempts < $2
           ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED`,
          [now, MAX_ATTEMPTS, BATCH],
        );
      const r: DrainResult = { dispatched: 0, failed: 0, givenUp: 0 };
      for (const row of rows) {
        const event: OutboxEvent = {
          outbox, id: row.id, type: row.event_type, aggregateId: row.aggregate_id, payload: row.payload, createdAt: row.created_at,
          attempt: row.attempts + 1,
        };
        const failures: string[] = [];
        for (const c of this.bus.consumersOf(row.event_type)) {
          try {
            await c.handler(event);
          } catch (e) {
            failures.push(`${c.name}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (failures.length === 0) {
          await m.query(`UPDATE ${table} SET dispatched_at = $2, attempts = attempts + 1 WHERE id = $1`, [row.id, this.clock.now()]);
          r.dispatched++;
          continue;
        }
        const attempts = row.attempts + 1;
        await m.query(`UPDATE ${table} SET attempts = $2, next_attempt_at = $3 WHERE id = $1`, [
          row.id, attempts, new Date(this.clock.now().getTime() + retryDelayMs(attempts)),
        ]);
        if (attempts >= MAX_ATTEMPTS) {
          r.givenUp++;
          // Reported to the operators: the event stays in its outbox, undispatched, for them to look at.
          this.log.error(`event ${table}#${row.id} (${row.event_type}) failed ${attempts} times and is no longer retried: ${failures.join('; ')}`);
        } else {
          r.failed++;
          this.log.warn(`event ${table}#${row.id} (${row.event_type}) attempt ${attempts} failed: ${failures.join('; ')}`);
        }
      }
      return r;
    });
  }
}
