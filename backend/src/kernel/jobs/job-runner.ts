import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../clock';

// The job runner (NFR-REL-03, DV-67; docs/design/09_integration.pdf section "Scheduled jobs"). Every unit's
// jobs run in every backend instance. The runner starts each job at its interval plus up to 10% random
// spread, so instances do not run in step; a job never overlaps itself within one instance. The first run
// comes soon after start, so whatever fell due during an outage is caught up at once. Correctness across
// instances is the job's own: it claims its due rows with FOR UPDATE SKIP LOCKED, re-checks their state in
// its transaction and acts on the recorded due time (forEachDue below), so no row is handled twice.
// Each run's duration and outcome are kept for the metrics (K-06).
export interface Job {
  /** '<unit>.<what>', e.g. 'identity.approvals.expire'. */
  name: string;
  intervalMs: number;
  /** Returns how many items it handled (for the metrics). */
  run(): Promise<number | void>;
}

export interface JobStats {
  name: string;
  intervalMs: number;
  runs: number;
  failures: number;
  handled: number;
  lastStartedAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export const SPREAD = 0.1; // DV-67
const FIRST_RUN_MAX_MS = 30_000;

@Injectable()
export class JobRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('JobRunner');
  private readonly jobs = new Map<string, { job: Job; stats: JobStats; timer?: NodeJS.Timeout; running?: Promise<void> }>();
  private started = false;
  private stopped = false;

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  register(job: Job): void {
    if (!/^[a-z_]+\.[a-z_.-]+$/.test(job.name)) throw new Error(`job name "${job.name}" must be <unit>.<what>`);
    if (this.jobs.has(job.name)) throw new Error(`job ${job.name} is already registered`);
    if (!(job.intervalMs >= 1_000)) throw new Error(`job ${job.name}: interval must be at least one second`);
    const stats: JobStats = {
      name: job.name, intervalMs: job.intervalMs, runs: 0, failures: 0, handled: 0, lastStartedAt: null, lastDurationMs: null, lastError: null,
    };
    this.jobs.set(job.name, { job, stats });
    if (this.started) this.schedule(job.name, this.firstDelay(job));
  }

  onApplicationBootstrap(): void {
    if (process.env.JOB_RUNNER === 'off') return; // tests that run jobs by hand
    this.started = true;
    for (const { job } of this.jobs.values()) this.schedule(job.name, this.firstDelay(job));
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    for (const j of this.jobs.values()) if (j.timer) clearTimeout(j.timer);
    await Promise.all([...this.jobs.values()].map((j) => j.running?.catch(() => undefined)));
  }

  /** Runs one job now (also used by tests); never overlaps a run already in progress. */
  async runNow(name: string): Promise<JobStats> {
    const j = this.jobs.get(name);
    if (!j) throw new Error(`unknown job ${name}`);
    if (j.running) {
      await j.running;
      return { ...j.stats };
    }
    j.running = this.execute(j.job, j.stats).finally(() => (j.running = undefined));
    await j.running;
    return { ...j.stats };
  }

  stats(): JobStats[] {
    return [...this.jobs.values()].map((j) => ({ ...j.stats }));
  }

  private async execute(job: Job, stats: JobStats): Promise<void> {
    const started = this.clock.now();
    stats.lastStartedAt = started;
    stats.runs++;
    try {
      const n = await job.run();
      stats.handled += typeof n === 'number' ? n : 0;
      stats.lastError = null;
    } catch (e) {
      stats.failures++;
      stats.lastError = e instanceof Error ? e.message : String(e);
      this.log.error(`job ${job.name} failed: ${stats.lastError}`);
    } finally {
      stats.lastDurationMs = this.clock.now().getTime() - started.getTime();
    }
  }

  private firstDelay(job: Job): number {
    return Math.random() * Math.min(job.intervalMs * SPREAD, FIRST_RUN_MAX_MS);
  }

  private schedule(name: string, delayMs: number): void {
    if (this.stopped) return;
    const j = this.jobs.get(name)!;
    j.timer = setTimeout(() => {
      void this.runNow(name).finally(() => this.schedule(name, j.job.intervalMs * (1 + Math.random() * SPREAD)));
    }, delayMs);
    j.timer.unref();
  }
}

/**
 * The claim pattern of NFR-REL-03: repeatedly takes one due row with FOR UPDATE SKIP LOCKED and handles it
 * in that row's own transaction, until none is left or `limit` rows are done. `select` must end with
 * "FOR UPDATE SKIP LOCKED" and return at most one row; `handle` re-checks the row's state before acting.
 * Several instances running the same job therefore share the rows and never handle one twice.
 */
export async function forEachDue<T>(
  db: DataSource,
  select: string,
  params: unknown[],
  handle: (row: T, m: EntityManager) => Promise<void>,
  limit = 500,
): Promise<number> {
  if (!/FOR UPDATE SKIP LOCKED\s*$/i.test(select.trim())) throw new Error('forEachDue: the query must end with FOR UPDATE SKIP LOCKED');
  let done = 0;
  while (done < limit) {
    const found = await db.transaction(async (m) => {
      const [row] = (await m.query(select, params)) as T[];
      if (!row) return false;
      await handle(row, m);
      return true;
    });
    if (!found) break;
    done++;
  }
  return done;
}
