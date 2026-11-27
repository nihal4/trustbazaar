import { Controller, Get } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { config } from '../../src/kernel/config/config';
import { HealthService } from '../../src/kernel/health/health.service';
import { Public } from '../../src/kernel/http/policies';
import { MetricsService } from '../../src/kernel/metrics/metrics.service';
import { drainAndClose } from '../../src/kernel/shutdown';
import { startApp, TestApp } from '../support/app';
import { Browser } from '../support/browser';

// K-06: the metrics server (NFR-OBS-03, DV-63, SEC-LOG-05) and the graceful shutdown (DV-66) of the running backend.
@Controller('test-slow')
class SlowController {
  static ms = 400;
  @Public()
  @Get()
  async slow() {
    await new Promise((r) => setTimeout(r, SlowController.ms));
    return { done: true };
  }
}

describe('metrics and graceful shutdown', () => {
  let t: TestApp;
  let metricsUrl: string;

  beforeAll(async () => {
    t = await startApp();
    metricsUrl = `http://127.0.0.1:${t.app.get(MetricsService).port()}/metrics`;
  });
  afterAll(async () => {
    await t?.close();
  });

  const scrape = async () => (await fetch(metricsUrl)).text();
  const value = (text: string, series: string) => {
    const line = text.split('\n').find((l) => l.startsWith(`${series} `));
    return line ? Number(line.split(' ').pop()) : 0;
  };

  it('NFR-OBS-03 DV-63 Prometheus metrics on their own port: requests by route, outboxes, jobs, live connections', async () => {
    await fetch(t.url('/health/live'));
    await fetch(t.url(`/orders/${randomUUID()}`)); // a route with an id: labelled by its pattern
    const text = await scrape();
    expect(value(text, 'tb_http_requests_total{method="GET",route="/api/v1/health/live",status="2xx"}')).toBeGreaterThanOrEqual(1);
    expect(text).toMatch(/tb_http_requests_total\{method="GET",route="\/api\/v1\/orders\/:id",status="4xx"\}/);
    expect(text).not.toMatch(/route="[^"]*[0-9a-f]{8}-[0-9a-f]{4}/); // no ids in labels
    expect(text).toContain('tb_http_request_duration_seconds_bucket');
    for (const o of ['identity', 'orders', 'auctions', 'delivery', 'game_accounts', 'chat', 'disputes'])
      expect(text).toContain(`tb_outbox_pending{outbox="${o}"}`);
    expect(text).toContain('tb_outbox_oldest_seconds{outbox="orders"}');
    expect(text).toMatch(/tb_job_runs\{job="orders\.payment\.expire"\} \d+/);
    expect(text).toMatch(/tb_websocket_connections \d+/);
    expect(text).toContain('tb_process_cpu_user_seconds_total');
    expect((await fetch(metricsUrl.replace('/metrics', '/other'))).status).toBe(404);
    // the API port does not serve them
    expect((await fetch(t.url('/metrics'))).status).toBe(404);
  });

  it('SEC-LOG-05 failed sign-ins are counted for alerting', async () => {
    const before = value(await scrape(), 'tb_signin_failures_total{kind="user"}');
    const b = new Browser(t, config().publicOrigin);
    await b.post('/auth/signin', { login: `nobody-${randomUUID().slice(0, 8)}@tb.test`, password: 'wrong-password-123' });
    expect(value(await scrape(), 'tb_signin_failures_total{kind="user"}')).toBe(before + 1);
  });

  it('DV-66 a shutdown answers not ready, finishes the request in progress, then refuses connections', async () => {
    const s = await startApp([SlowController]);
    const port = s.app.get(MetricsService).port();
    SlowController.ms = 400;
    const inFlight = fetch(s.url('/test-slow'));
    await new Promise((r) => setTimeout(r, 100));
    const health = s.app.get(HealthService);
    const stopping = drainAndClose(s.app, 5_000);
    expect(await health.readiness()).toMatchObject({ ready: false, draining: true });
    const r = await inFlight;
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ done: true });
    await stopping;
    await expect(fetch(s.url('/health/live'))).rejects.toThrow();
    await expect(fetch(`http://127.0.0.1:${port}/metrics`)).rejects.toThrow(); // the metrics server is closed too
  });

  it('DV-66 a request still open at the end of the grace period is cut', async () => {
    const s = await startApp([SlowController]);
    SlowController.ms = 3_000;
    const inFlight = fetch(s.url('/test-slow')).then(
      (r) => r.status,
      () => 'cut',
    );
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    await drainAndClose(s.app, 300);
    expect(Date.now() - started).toBeLessThan(2_500);
    expect(await inFlight).toBe('cut');
  });
});
