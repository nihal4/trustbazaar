// What makes the screenshot tests repeatable (U11-02). A page is shown from a recorded fixture (record.mjs), never from the live system; the clock is frozen at the time of the recording, so a
// countdown or "in 13 days" reads the same every run; animations are off; images and the live connection are replaced; fonts are awaited. Two runs in a row must give no difference.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  recordedAt: string;
  path: string;
  answers: Record<string, { status: number; body: unknown }>;
}
export const loadFixture = (name: string): Fixture => JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));

// one grey picture for every photo and file the page asks for: what a photo shows is not what these tests are about, and a real photo would change with the demo data
const PICTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#8a949e"/><path d="M0 220 120 130 200 190 280 110 400 200V300H0Z" fill="#6f7a85"/></svg>';

export interface Look {
  theme: 'dark' | 'light';
  lang: 'en' | 'bn';
  width: number;
  height?: number;
}

/** Opens a screen as the fixture recorded it. `unmatched` lists the requests the fixture has no answer for (a test can assert it is empty). */
export async function openScreen(page: Page, fixtureName: string, look: Look, path?: string): Promise<{ unmatched: string[] }> {
  const fixture = loadFixture(fixtureName);
  const unmatched: string[] = [];
  await page.setViewportSize({ width: look.width, height: look.height ?? 900 });
  // the clock is the page's own: dates, countdowns and every timer of the page (an animated demo counter on the home page included) are the same each run once it is paused (below)
  // installed, and stopped at once: the page loads with the clock standing still, so every timer of the page starts at the same moment however long the load takes
  await page.clock.install({ time: new Date(fixture.recordedAt) });
  await page.clock.pauseAt(new Date(Date.parse(fixture.recordedAt) + 1_000));
  await page.addInitScript(
    ([theme, lang]) => {
      try {
        localStorage.setItem('tb-theme', theme);
        localStorage.setItem('tb-lang', lang);
      } catch {
        /* storage blocked */
      }
    },
    [look.theme, look.lang],
  );

  // Playwright runs the route registered last first: the general rule comes first here, the special ones after it
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const key = `${route.request().method()} ${url.pathname.slice('/api/v1'.length)}`;
    // the app tries to refresh a session when it starts; with no session the answer is "none" (the fixture is of a screen, not of a session)
    if (key === 'POST /auth/refresh' || key === 'POST /staff/auth/refresh')
      return route.fulfill({ status: 401, contentType: 'application/problem+json', body: JSON.stringify({ type: '/problems/session-ended' }) });
    // a signed-in page saves the language it was opened in; nothing on the screen depends on the answer
    if (key === 'PUT /me/notification-preferences')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ language: look.lang, emailTransactional: true }) });
    // what the server answers with no body (204): no data export requested yet (trust.controller.ts exportStatus); a conversation marked as read when it is opened
    if (key === 'GET /me/data-export' || /^POST \/threads\/[^/]+\/marks$/.test(key)) return route.fulfill({ status: 204 });
    const answer = fixture.answers[key + url.search] ?? fixture.answers[key];
    if (!answer) {
      unmatched.push(key);
      return route.fulfill({
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({ type: '/problems/not-found', title: 'not in the fixture' }),
      });
    }
    return route.fulfill({
      status: answer.status,
      contentType: 'application/json',
      headers: { Date: new Date(fixture.recordedAt).toUTCString() },
      body: JSON.stringify(answer.body),
    });
  });
  await page.route(/\/api\/v1\/(listing-photos|files)\//, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PICTURE }));
  await page.route('**/socket.io/**', (route) => route.abort());

  await page.goto(path ?? fixture.path, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  // then the clock is moved ten seconds on, the same each run: the language skeleton leaves, a second-by-second counter has counted ten, and it stands still again
  // a second at a time, each time letting what the timers asked for arrive (a refetch, a retry), so no answer is still on its way when the picture is taken
  for (let second = 0; second < 10; second++) {
    await page.clock.runFor(1_000);
    await page.waitForLoadState('networkidle');
  }
  await expect(page.getByText(/^Loading…$|^লোড হচ্ছে/)).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  // what the graphics card draws (a canvas) is hidden, not masked (see `volatile` below); set on the element, because the page's content security policy refuses a stylesheet
  await page.evaluate(() => document.querySelectorAll('canvas').forEach((c) => c.style.setProperty('visibility', 'hidden', 'important')));
  // a transition that is still running when the picture is taken (a border changing colour after the theme was set) would be drawn half way, and how far it got depends on how long the
  // page took to get here: a change that only moved the timing would then look like a change of the screen. Every running one is finished, so the picture shows the settled state
  // (an endless one throws; those are the live dots, which the screenshot call stops itself)
  await page.evaluate(() =>
    document.getAnimations().forEach((a) => {
      try {
        a.finish();
      } catch {
        /* an animation that never ends */
      }
    }),
  );
  await page.clock.runFor(50);
  return { unmatched };
}

/** What changes with the camera or is the hero's shader: left out of the picture. (Canvases are hidden by openScreen, not masked: a mask is a box drawn over the picture, and on the sign-in page the canvas is the whole screen, so it hid the form too.) */
export const volatile = (page: Page) => [page.locator('video'), page.locator('section[data-theme="dark"]')];
