// The screenshot tests (U11-02): every main screen as a picture, so that a refactor that must change nothing can show that it changed nothing. Run them in the pinned container
// (e2e/visual/run.sh), as CI does: the baselines are made there, so the fonts are drawn the same way everywhere. The file name of a baseline has no operating system in it on purpose.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.VISUAL_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: here,
  testMatch: /.*\.visual\.ts$/,
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  timeout: 60_000,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  // no different pixel is allowed: two runs in a row give the same picture (checked when this was made), so any difference is a change. A logo is smaller than 0.1% of a phone page, so a ratio would hide it.
  expect: { toHaveScreenshot: { maxDiffPixels: 0, threshold: 0.1, animations: 'disabled', caret: 'hide', scale: 'css' } },
  use: { baseURL: base, locale: 'en-GB', timezoneId: 'Asia/Dhaka', reducedMotion: 'reduce', deviceScaleFactor: 1 },
  // the production build, served as the web container serves it (e2e/serve.mjs); needs `npm run build` first
  webServer: process.env.VISUAL_BASE_URL ? undefined : { command: 'node e2e/serve.mjs', cwd: `${here}/../..`, url: `${base}/healthz`, reuseExistingServer: true, timeout: 30_000 },
});
