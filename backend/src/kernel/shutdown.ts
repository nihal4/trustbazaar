import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Server } from 'http';
import { OutboxDispatcher } from './events/outbox-dispatcher';
import { HealthService } from './health/health.service';
import { JobRunner } from './jobs/job-runner';
import { LiveGateway } from './live/live.gateway';

// Graceful shutdown (docs/design/09_integration.pdf section 8.2; DV-66; K-06). On SIGTERM (Compose's stop, which
// allows 30 seconds) or SIGINT the backend:
//  1. answers not ready on /health/ready, so no new requests are routed to it;
//  2. stops its scheduled jobs and the outbox dispatcher, waiting for the runs in progress;
//  3. stops accepting connections, closes idle keep-alive ones, and lets the requests in progress finish, for at
//     most the grace period (25 s, inside Compose's 30), after which the remaining connections are cut;
//  4. closes the live connections (clients reconnect elsewhere or after the restart, then resync), then the
//     application: its shutdown hooks, the database pool and Redis.
// Nest's own shutdown hooks are not enabled: they would close Redis and the database before the requests end.
export const GRACE_MS = 25_000;
const log = new Logger('Shutdown');

export async function drainAndClose(app: INestApplication, graceMs = GRACE_MS): Promise<void> {
  const started = Date.now();
  app.get(HealthService).drain();
  await Promise.all([app.get(JobRunner).onApplicationShutdown(), app.get(OutboxDispatcher).onApplicationShutdown()]);
  const server = app.getHttpServer() as Server;
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  server.closeIdleConnections();
  let timer: NodeJS.Timeout | undefined;
  const cut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(0, graceMs - (Date.now() - started)));
  });
  if ((await Promise.race([closed.then(() => 'closed' as const), cut])) === 'timeout') {
    log.warn({ msg: 'requests still open at the end of the grace period: cut', graceMs });
    server.closeAllConnections();
  }
  clearTimeout(timer);
  app.get(LiveGateway).disconnectAll();
  await app.close();
  log.log({ msg: 'stopped', ms: Date.now() - started });
}

/** Installs the handlers once; a second signal during the shutdown is ignored. */
export function onShutdownSignals(app: INestApplication, exit: (code: number) => void = (c) => process.exit(c)): void {
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.log({ msg: 'shutting down', signal });
    drainAndClose(app).then(
      () => exit(0),
      (err: Error) => {
        log.error({ msg: 'shutdown failed', error: err });
        exit(1);
      },
    );
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}
