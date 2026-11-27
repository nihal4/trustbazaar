// The inventory run (U11-13): harvest.inventory.ts in the pinned container, against the production build served as the web container serves it (see e2e/visual/visual.config.ts).
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.VISUAL_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: here,
  testMatch: /harvest\.inventory\.ts$/,
  workers: 3,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: base, locale: 'en-GB', timezoneId: 'Asia/Dhaka', reducedMotion: 'reduce' },
  webServer: process.env.VISUAL_BASE_URL
    ? undefined
    : { command: 'node e2e/serve.mjs', cwd: `${here}/../..`, url: `${base}/healthz`, reuseExistingServer: true, timeout: 30_000 },
});
