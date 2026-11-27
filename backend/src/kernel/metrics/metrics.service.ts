import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { createServer, Server } from 'http';
import type { AddressInfo } from 'net';
import { collectDefaultMetrics, Gauge } from 'prom-client';
import { DataSource } from 'typeorm';
import { TbConfig } from '../config/config';
import { TB_CONFIG } from '../config/config.provider';
import { OUTBOXES } from '../events/outbox-dispatcher';
import { JobRunner } from '../jobs/job-runner';
import { LiveGateway } from '../live/live.gateway';
import { registry } from './metrics';

// The metrics server (docs/design/09_integration.pdf section 8.3; NFR-OBS-03, DV-63; K-06). Prometheus format at
// GET /metrics on METRICS_PORT (9464), inside the edge network: nginx does not forward it, so it is not public. Besides
// the counters of metrics.ts it reads, at each scrape, the open WebSocket connections, the depth and age of each unit's
// outbox, and each job's runs, failures, handled items and last duration; plus Node's own process metrics.
@Injectable()
export class MetricsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('Metrics');
  private server?: Server;
  private static gauges = false;

  constructor(
    private readonly db: DataSource,
    private readonly jobs: JobRunner,
    private readonly live: LiveGateway,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
  ) {
    MetricsService.register(this);
  }

  /** The gauges read at scrape time, registered once per process and bound to the latest service. */
  private static current?: MetricsService;
  private static register(s: MetricsService) {
    MetricsService.current = s;
    if (MetricsService.gauges) return;
    MetricsService.gauges = true;
    collectDefaultMetrics({ register: registry, prefix: 'tb_' });
    new Gauge({
      name: 'tb_websocket_connections',
      help: 'Open live (Socket.IO) connections on this instance',
      registers: [registry],
      collect() {
        this.set(MetricsService.current?.live.connections() ?? 0);
      },
    });
    new Gauge({
      name: 'tb_outbox_pending',
      help: 'Events not yet dispatched, per unit outbox',
      labelNames: ['outbox'],
      registers: [registry],
      async collect() {
        for (const o of await (MetricsService.current?.outboxes() ?? [])) this.set({ outbox: o.outbox }, o.pending);
      },
    });
    new Gauge({
      name: 'tb_outbox_oldest_seconds',
      help: 'Age of the oldest undispatched event, per unit outbox (alert above 5 minutes)',
      labelNames: ['outbox'],
      registers: [registry],
      async collect() {
        for (const o of await (MetricsService.current?.outboxes() ?? [])) this.set({ outbox: o.outbox }, o.oldestSeconds);
      },
    });
    const jobGauge = (name: string, help: string, pick: (s: ReturnType<JobRunner['stats']>[number]) => number) =>
      new Gauge({
        name,
        help,
        labelNames: ['job'],
        registers: [registry],
        collect() {
          for (const s of MetricsService.current?.jobs.stats() ?? []) this.set({ job: s.name }, pick(s));
        },
      });
    jobGauge('tb_job_runs', 'Runs of each scheduled job since start', (s) => s.runs);
    jobGauge('tb_job_failures', 'Failed runs of each scheduled job since start (alert on three in a row)', (s) => s.failures);
    jobGauge('tb_job_handled', 'Items handled by each scheduled job since start', (s) => s.handled);
    jobGauge('tb_job_last_duration_seconds', 'Duration of the last run of each scheduled job', (s) => (s.lastDurationMs ?? 0) / 1000);
    jobGauge('tb_job_last_failed', '1 if the last run of the job failed', (s) => (s.lastError ? 1 : 0));
  }

  /** Depth and age of each unit's outbox; an unreachable database gives no sample rather than a failed scrape. */
  async outboxes(): Promise<{ outbox: string; pending: number; oldestSeconds: number }[]> {
    try {
      const rows = (await this.db.query(
        OUTBOXES.map(
          (o, i) => `SELECT $${i + 1}::text AS outbox, count(*)::int AS pending,
                 coalesce(extract(epoch FROM now() - min(created_at)), 0)::float AS oldest
            FROM ${o}.outbox WHERE dispatched_at IS NULL`,
        ).join(' UNION ALL '),
        [...OUTBOXES],
      )) as { outbox: string; pending: number; oldest: number }[];
      return rows.map((r) => ({ outbox: r.outbox, pending: r.pending, oldestSeconds: r.oldest }));
    } catch (e) {
      this.log.warn(`outbox metrics unavailable: ${(e as Error).message}`);
      return [];
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.metricsPort === null) return;
    this.server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url?.split('?')[0] !== '/metrics') {
        res.writeHead(404).end();
        return;
      }
      registry.metrics().then(
        (body) => res.writeHead(200, { 'Content-Type': registry.contentType }).end(body),
        (err: Error) => {
          this.log.error({ msg: 'metrics scrape failed', error: err });
          res.writeHead(500).end();
        },
      );
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.config.metricsPort!, () => resolve());
    });
    this.log.log({ msg: 'metrics listening', port: this.port() });
  }

  /** The port the metrics server listens on (the configured one, or the free port chosen for 0). */
  port(): number | null {
    return (this.server?.address() as AddressInfo | null)?.port ?? null;
  }

  async onApplicationShutdown(): Promise<void> {
    const s = this.server;
    this.server = undefined;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }
}
