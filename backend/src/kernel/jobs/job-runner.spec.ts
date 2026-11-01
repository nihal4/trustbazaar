import { JobRunner } from './job-runner';

const clock = { now: () => new Date() };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('job runner (NFR-REL-03, DV-67)', () => {
  it('DV-67 a job is named <unit>.<what>, registered once, with an interval of at least a second', () => {
    const r = new JobRunner(clock);
    r.register({ name: 'identity.approvals.expire', intervalMs: 60_000, run: async () => 0 });
    expect(() => r.register({ name: 'identity.approvals.expire', intervalMs: 60_000, run: async () => 0 })).toThrow();
    expect(() => r.register({ name: 'NoUnit', intervalMs: 60_000, run: async () => 0 })).toThrow();
    expect(() => r.register({ name: 'orders.fast', intervalMs: 10, run: async () => 0 })).toThrow();
  });

  it('NFR-REL-03 runs record the count handled, the duration and failures; a failure does not stop the job', async () => {
    const r = new JobRunner(clock);
    let fail = true;
    r.register({ name: 'orders.release', intervalMs: 60_000, run: async () => { if (fail) throw new Error('db down'); return 3; } });
    expect(await r.runNow('orders.release')).toMatchObject({ runs: 1, failures: 1, handled: 0, lastError: 'db down' });
    fail = false;
    expect(await r.runNow('orders.release')).toMatchObject({ runs: 2, failures: 1, handled: 3, lastError: null });
    expect(r.stats()[0].lastDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('NFR-REL-03 a job never overlaps itself in one instance', async () => {
    const r = new JobRunner(clock);
    let active = 0;
    let max = 0;
    r.register({ name: 'auctions.close', intervalMs: 1_000, run: async () => { active++; max = Math.max(max, active); await sleep(30); active--; } });
    await Promise.all([r.runNow('auctions.close'), r.runNow('auctions.close'), r.runNow('auctions.close')]);
    expect(max).toBe(1);
    expect(r.stats()[0].runs).toBe(1);
  });

  it('NFR-REL-03 after start the first run comes soon, then again at the interval plus at most 10%', async () => {
    const r = new JobRunner(clock);
    const at: number[] = [];
    r.register({ name: 'delivery.reconcile', intervalMs: 1_000, run: async () => void at.push(Date.now()) });
    const t0 = Date.now();
    r.onApplicationBootstrap();
    await sleep(1_400);
    await r.onApplicationShutdown();
    expect(at.length).toBeGreaterThanOrEqual(2);
    expect(at[0] - t0).toBeLessThanOrEqual(150); // at most 10% of the interval
    const gap = at[1] - at[0];
    expect(gap).toBeGreaterThanOrEqual(990);
    expect(gap).toBeLessThanOrEqual(1_150);
  });
});
