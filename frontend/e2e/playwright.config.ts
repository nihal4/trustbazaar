// The web client's end-to-end runs (U8-11; docs/design/08_frontend.pdf section 12). With E2E_BASE_URL set they run
// against that system (the Compose system in CI, Unit 9); without it they start the backend stack and the web server
// here, which needs DATABASE_URL and REDIS_URL as the backend's integration tests do (backend/test/README.md) and a
// production build (npm run build).
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

const base = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const local = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.e2e\.ts$/,
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: base, locale: 'en-GB', timezoneId: 'Asia/Dhaka', trace: 'retain-on-failure' },
  webServer: local
    ? [
        {
          command: 'npx ts-node --transpile-only test/e2e/stack.ts',
          cwd: '../../backend',
          url: 'http://127.0.0.1:3100/api/v1/health/live',
          reuseExistingServer: true,
          timeout: 120_000,
          env: { E2E_FIXTURES: `${here}/.fixtures.json` },
        },
        { command: 'node e2e/serve.mjs', cwd: '..', url: `${base}/healthz`, reuseExistingServer: true, timeout: 30_000 },
      ]
    : undefined,
});
