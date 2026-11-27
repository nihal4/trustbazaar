#!/usr/bin/env node
// Records what the real backend answers to one screen, as a fixture for the screenshot tests (U11-02). The screenshot tests never use the live system (its tokens, mailbox codes, chat
// threads, countdowns and unread counts change from one run to the next): they replay these files. Run it by hand, when a screen's data has to change:
//
//   node e2e/visual/record.mjs <name> <path> [--session <storage-state.json>] [--base http://localhost:5173] [--document kyc|staff|secure]
//
// It opens the path, waits until the page is quiet, and writes e2e/visual/fixtures/<name>.json: every JSON answer of /api/v1 (key "METHOD /path?query"), and the time of the recording, which the
// tests freeze the clock to. Review the file before committing it: it holds the demo accounts' data (names, e-mail addresses of the demo accounts), never a real person's.
import { chromium } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [name, path, ...rest] = process.argv.slice(2);
const opt = (flag, fallback) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : fallback);
if (!name || !path) {
  console.error('usage: node e2e/visual/record.mjs <name> <path> [--session file] [--base url]');
  process.exit(1);
}

const base = opt('--base', 'http://localhost:5173');
// the recording only reads data, so any Chrome will do (CHROME=path); the screenshots are made in the pinned container (see visual.config.ts)
const chrome = process.env.CHROME ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => existsSync(p));
const browser = await chromium.launch(chrome ? { executablePath: chrome } : {});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-GB',
  timezoneId: 'Asia/Dhaka',
  ...(opt('--session') ? { storageState: opt('--session') } : {}),
});
const page = await context.newPage();
const answers = {};
page.on('response', async (response) => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith('/api/v1/') || response.request().method() !== 'GET') return;
  const type = response.headers()['content-type'] ?? '';
  if (!type.includes('json')) return;
  try {
    answers[`GET ${url.pathname.slice('/api/v1'.length)}${url.search}`] = { status: response.status(), body: await response.json() };
  } catch {
    /* an empty answer */
  }
});
const recordedAt = new Date().toISOString();
await page.goto(base + path, { waitUntil: 'networkidle' });
await page.waitForTimeout(Number(process.env.RECORD_WAIT ?? 2500)); // RECORD_WAIT (ms) for pages that poll or load on a timer
await browser.close();
writeFileSync(join(here, 'fixtures', `${name}.json`), JSON.stringify({ recordedAt, path, answers }, null, 2) + '\n');
console.log(`${name}: ${Object.keys(answers).length} answers recorded at ${recordedAt}`);
