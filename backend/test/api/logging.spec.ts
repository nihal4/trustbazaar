import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { JsonLogger, LogLine } from '../../src/kernel/logging/json-logger';
import { startApp, TestApp } from '../support/app';

// K-02: the running backend's log lines (docs/design/09_integration.pdf section 8.3; NFR-OBS-02, SEC-DAT-07), captured
// from the logger main.ts installs: one JSON line per request with its correlation id, and nothing of what was sent.
describe('logging', () => {
  let t: TestApp;
  const lines: LogLine[] = [];

  beforeAll(async () => {
    t = await startApp();
    t.app.useLogger(new JsonLogger('info', (l) => lines.push(JSON.parse(l))));
  });
  afterAll(async () => {
    Logger.overrideLogger(false);
    await t?.close();
  });

  const lineOf = (correlationId: string) => lines.find((l) => l.correlationId === correlationId && l.msg === 'request');

  it('NFR-OBS-02 SEC-LOG-03 every request writes one JSON line with its correlation id, method, path, status, time, actor and address', async () => {
    const id = randomUUID();
    const r = await fetch(t.url('/health/live?probe=1'), { headers: { 'x-correlation-id': id } });
    expect(r.headers.get('x-correlation-id')).toBe(id);
    await new Promise((resolve) => setImmediate(resolve));
    expect(lineOf(id)).toEqual({
      time: expect.stringMatching(/Z$/), level: 'info', module: 'http', msg: 'request', correlationId: id,
      method: 'GET', path: '/api/v1/health/live', status: 200, ms: expect.any(Number), actor: 'anonymous', ip: expect.any(String),
    });
  });

  it('SEC-DAT-07 neither the body, the headers nor the query of a request reach the log', async () => {
    const id = randomUUID();
    await fetch(t.url('/auth/signin?token=QUERYSECRET'), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': id, cookie: 'tb_session=COOKIESECRET', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ identifier: '+8801711000999', password: 'BODYSECRET-password-1' }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(lineOf(id)).toMatchObject({ method: 'POST', path: '/api/v1/auth/signin', status: expect.any(Number) });
    const all = JSON.stringify(lines);
    for (const secret of ['QUERYSECRET', 'COOKIESECRET', 'BODYSECRET', '+8801711000999']) expect(all).not.toContain(secret);
  });
});
