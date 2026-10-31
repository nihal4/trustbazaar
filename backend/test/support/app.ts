import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { requireEnv, useTestSecrets } from './env';

export interface TestApp {
  app: INestApplication;
  url: (path: string) => string;
  close: () => Promise<void>;
}

// Starts the whole backend (kernel and seven units) on a free port, configured exactly as main.ts does.
// API tests call it over HTTP with fetch: url('/health/live') -> http://127.0.0.1:<port>/api/v1/health/live
export async function startApp(): Promise<TestApp> {
  requireEnv('DATABASE_URL');
  requireEnv('REDIS_URL');
  useTestSecrets();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication({ logger: false }));
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    url: (path) => `http://127.0.0.1:${port}${path.startsWith('/api/') ? '' : '/api/v1'}${path}`,
    close: () => app.close(),
  };
}
