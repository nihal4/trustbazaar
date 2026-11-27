import { EventEmitter } from 'events';
import { httpMetrics, noteDatabaseError, registry, securityEvents } from './metrics';
import { MetricsService } from './metrics.service';
import { onShutdownSignals } from '../shutdown';

// K-06 with fakes; the running backend's metrics and shutdown are in test/api/metrics-shutdown.spec.ts.
describe('metrics (NFR-OBS-03, SEC-LOG-05)', () => {
  const series = async (name: string) => (await registry.getSingleMetric(name)!.get()).values;

  it('NFR-OBS-03 a request is counted by its route pattern and status class, an unmatched one as unmatched', async () => {
    const run = (route: string | undefined, status: number) => {
      const res = Object.assign(new EventEmitter(), { statusCode: status });
      httpMetrics({ method: 'POST', baseUrl: '', route: route ? { path: route } : undefined } as never, res as never, () => undefined);
      res.emit('finish');
    };
    run('/api/v1/unit-test/:id', 201);
    run(undefined, 404);
    const counts = await series('tb_http_requests_total');
    expect(counts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { method: 'POST', route: '/api/v1/unit-test/:id', status: '2xx' }, value: 1 }),
        expect.objectContaining({ labels: { method: 'POST', route: 'unmatched', status: '4xx' } }),
      ]),
    );
  });

  it('SEC-LOG-05 a database refusal of an escrow change is counted; other errors are not', async () => {
    const before = (await series('tb_escrow_transitions_rejected_total'))[0]?.value ?? 0;
    noteDatabaseError({ driverError: { message: 'escrow released -> held is not permitted' } });
    noteDatabaseError(new Error('escrow is terminal'));
    noteDatabaseError(new Error('duplicate key value'));
    noteDatabaseError(null);
    expect((await series('tb_escrow_transitions_rejected_total'))[0].value).toBe(before + 2);
    securityEvents.kycViews.inc({ staff: 's1' });
    expect(await series('tb_kyc_views_total')).toEqual([expect.objectContaining({ labels: { staff: 's1' }, value: 1 })]);
  });

  it('NFR-OBS-03 the outbox gauges skip a scrape the database cannot answer; no server without a port', async () => {
    const s = new MetricsService(
      { query: jest.fn().mockRejectedValue(new Error('down')) } as never,
      { stats: () => [] } as never,
      { connections: () => 0 } as never,
      { metricsPort: null } as never,
    );
    expect(await s.outboxes()).toEqual([]);
    await s.onApplicationBootstrap();
    expect(s.port()).toBeNull();
    await s.onApplicationShutdown();
    expect(await registry.metrics()).toContain('tb_websocket_connections 0');
  });
});

describe('shutdown signals (DV-66)', () => {
  it('DV-66 SIGTERM starts one shutdown; a second signal is ignored; a failure exits 1', async () => {
    const before = process.listenerCount('SIGTERM');
    const exit = jest.fn();
    const close = jest.fn(async () => {
      throw new Error('boom');
    });
    const app = {
      get: () => {
        throw new Error('no app');
      },
      close,
    } as never;
    onShutdownSignals(app, exit);
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    process.emit('SIGTERM');
    process.emit('SIGINT');
    await new Promise((r) => setImmediate(r));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
