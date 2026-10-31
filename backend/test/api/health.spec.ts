import { startApp, TestApp } from '../support/app';

// NFR-OBS-01 against the real PostgreSQL (as tb_app) and Redis; the unit tests use fakes.
describe('health endpoints', () => {
  let t: TestApp;
  beforeAll(async () => (t = await startApp()));
  afterAll(async () => t.close());

  it('NFR-OBS-01 GET /api/v1/health/live answers 200', async () => {
    const res = await fetch(t.url('/health/live'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('NFR-OBS-01 GET /api/v1/health/ready answers 200 when PostgreSQL and Redis answer', async () => {
    const res = await fetch(t.url('/health/ready'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('DC-3 nothing is served outside /api/v1', async () => {
    expect((await fetch(t.url('/api/health/live'))).status).toBe(404);
  });
});
