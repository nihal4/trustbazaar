import { HttpStatus } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { HealthController } from './health.controller';
import { HEALTH_TIMEOUT_MS, HealthService, probe } from './health.service';

// NFR-OBS-01 and DV-61 (docs/design/09_integration.pdf, section 5.2). PostgreSQL and Redis are fakes
// here; the pull request records the same cases against real servers.
const answers = () => Promise.resolve('ok');
const fails = () => Promise.reject(new Error('connection refused'));
const hangs = () => new Promise<never>(() => undefined);

function controllerWith(db: () => Promise<unknown>, redis: () => Promise<unknown>) {
  const service = new HealthService({ query: db } as unknown as DataSource, { ping: redis } as never);
  return new HealthController(service);
}

async function callReady(controller: HealthController) {
  let status = 0;
  const res = { status: (code: number) => ((status = code), res) };
  const body = await controller.ready(res as never);
  return { status, body };
}

describe('health', () => {
  it('NFR-OBS-01 live answers while the process runs, without touching the database or Redis', () => {
    const controller = controllerWith(fails, fails);
    expect(controller.live()).toEqual({ status: 'ok' });
  });

  it('NFR-OBS-01 ready answers 200 when PostgreSQL and Redis both answer', async () => {
    expect(await callReady(controllerWith(answers, answers))).toEqual({ status: HttpStatus.OK, body: { status: 'ok' } });
  });

  it.each([
    ['PostgreSQL fails', fails, answers],
    ['Redis fails', answers, fails],
    ['both fail', fails, fails],
  ])('NFR-OBS-01 ready answers 503 when %s, and names no dependency', async (_case, db, redis) => {
    const { status, body } = await callReady(controllerWith(db, redis));
    expect(status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toEqual({ status: 'unavailable' });
  });

  describe('timeouts', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('DV-61 a dependency that does not answer within 2 seconds is down', async () => {
      const result = probe(hangs);
      await jest.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS - 1);
      let settled = false;
      void result.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(await result).toBe('down');
    });

    it('DV-61 ready answers 503 within 2 seconds when Redis hangs', async () => {
      const pending = callReady(controllerWith(answers, hangs));
      await jest.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
      expect((await pending).status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  it('DV-61 the timeout is 2 seconds', () => {
    expect(HEALTH_TIMEOUT_MS).toBe(2000);
  });
});
