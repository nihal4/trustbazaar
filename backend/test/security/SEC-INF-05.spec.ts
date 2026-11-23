import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from '../../src/kernel/http/policies';
import { loadConfig } from '../../src/kernel/config/config';
import { startApp, type TestApp } from '../support/app';
import { useTestSecrets } from '../support/env';

// SEC-INF-05: the production configuration disables debug output and automatic schema synchronisation.
useTestSecrets();

@Controller('test-inf-05')
class Failing {
  @Public()
  @Get()
  fail() {
    throw new Error('internal detail: connection to 10.0.0.5 failed at /srv/app/dist/x.js:12');
  }
}

describe('SEC-INF-05 production configuration', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp([Failing]); // one backend for the file: its routes plus a failing one
  });
  afterAll(async () => {
    await t?.close();
  });

  it('SEC-INF-05 debug logging is refused in production', () => {
    expect(() => loadConfig({ ...process.env, TB_ENV: 'production', NODE_ENV: 'production', LOG_LEVEL: 'debug' })).toThrow(/LOG_LEVEL: debug output is off in production \(SEC-INF-05\)/);
  });

  it('SEC-INF-05 the database connection never synchronises the schema, nor runs migrations itself', async () => {
    const options = t.app.get(DataSource).options as { synchronize?: boolean; migrationsRun?: boolean; dropSchema?: boolean };
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun ?? false).toBe(false);
    expect(options.dropSchema ?? false).toBe(false);
  });

  it('SEC-INF-05 an internal error answers with no message, stack or path', async () => {
    const r = await fetch(t.url('/test-inf-05'));
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(text).not.toMatch(/internal detail|10\.0\.0\.5|\/srv\/app|x\.js|\bat \w/);
    expect(JSON.parse(text)).toEqual({ type: expect.stringMatching(/internal$/), title: expect.any(String), status: 500, correlationId: expect.any(String) });
  });
});
