// Before the runs: wait for the backend stack's fixtures, then sign in once as each role through the real sign-in
// screens and keep the browser state (cookies), so every test starts signed in without signing in again.
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type FullConfig } from '@playwright/test';
import { FIXTURES, fixtures, signInMember, signInStaff, STATES } from './fixtures';

export default async function globalSetup(config: FullConfig) {
  const started = Date.now();
  while (!existsSync(FIXTURES) || statSync(FIXTURES).mtimeMs < started - 10 * 60_000) {
    if (Date.now() - started > 120_000) throw new Error(`the backend stack wrote no fixtures to ${FIXTURES}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const f = fixtures();
  mkdirSync(STATES, { recursive: true });
  const baseURL = config.projects[0].use.baseURL;
  const browser = await chromium.launch();
  for (const [name, signIn] of [
    ['buyer', (p: import('@playwright/test').Page) => signInMember(p, f.buyer)],
    ['operator', (p: import('@playwright/test').Page) => signInStaff(p, f.operator)],
    ['administrator', (p: import('@playwright/test').Page) => signInStaff(p, f.administrator)],
  ] as const) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await signIn(page);
    await context.storageState({ path: join(STATES, `${name}.json`) });
    await context.close();
  }
  await browser.close();
}
