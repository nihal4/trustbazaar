// The main screens, each from its fixture (record.mjs), in both themes, at the phone (390 px) and the desktop (1440 px) width, in English; Bangla at 390 px for the text-heavy screens;
// and interactive states (an open popup). Screens and states are added to these lists as the clean-up reaches them (U11-02 onwards): a screen has to be in the net before it is changed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openScreen, volatile } from './harness';

const SCREENS = [
  { name: 'order-buyer-pay', fixture: 'order-buyer-pay' },
  { name: 'order-buyer-dispute', fixture: 'order-buyer-dispute' },
  { name: 'dispute-seller-return', fixture: 'dispute-seller-return' },
  { name: 'home', fixture: 'home' },
  { name: 'order-buyer', fixture: 'order-buyer' },
  { name: 'order-seller', fixture: 'order-seller' },
  { name: 'dispute-chat-seller', fixture: 'dispute-seller' },
];

for (const screen of SCREENS) {
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [390, 1440]) {
      test(`${screen.name} ${theme} ${width}`, async ({ page }) => {
        const { unmatched } = await openScreen(page, screen.fixture, { theme, lang: 'en', width });
        expect(unmatched, 'requests the fixture has no answer for').toEqual([]);
        await expect(page).toHaveScreenshot(`${screen.name}-${theme}-${width}.png`, { fullPage: true, mask: volatile(page) });
      });
    }
  }
}

// Every other recorded screen (screens.json): the dark theme at both widths and the light theme on the desktop, so a change to a shared style shows on every page that uses it
const DONE = new Set(['home', 'order-buyer', 'order-seller', 'dispute-seller', 'order-buyer-pay', 'order-buyer-dispute', 'dispute-seller-return']);
const REST: { name: string }[] = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'screens.json'), 'utf8')).filter(
  (s: { name: string }) => !DONE.has(s.name),
);
for (const screen of REST) {
  for (const [theme, width] of [
    ['dark', 390],
    ['dark', 1440],
    ['light', 1440],
  ] as const) {
    test(`${screen.name} ${theme} ${width}`, async ({ page }) => {
      const { unmatched } = await openScreen(page, screen.name, { theme, lang: 'en', width });
      expect(unmatched, 'requests the fixture has no answer for').toEqual([]);
      await expect(page).toHaveScreenshot(`${screen.name}-${theme}-${width}.png`, { fullPage: true, mask: volatile(page) });
    });
  }
}

// Bangla has longer words and its own line height: the text-heavy screens at the phone width, dark
for (const screen of SCREENS.filter(
  (s) => s.name !== 'order-seller' && !s.name.endsWith('-pay') && !s.name.endsWith('-dispute') && !s.name.endsWith('-return'),
)) {
  test(`${screen.name} dark 390 bangla`, async ({ page }) => {
    const { unmatched } = await openScreen(page, screen.fixture, { theme: 'dark', lang: 'bn', width: 390 });
    expect(unmatched, 'requests the fixture has no answer for').toEqual([]);
    await expect(page).toHaveScreenshot(`${screen.name}-dark-390-bn.png`, { fullPage: true, mask: volatile(page) });
  });
}

// Interactive states: where the duplicated buttons, steppers and popups live, and a page-load picture does not show them
const STATES = [
  {
    name: 'order-seller-handover-popup',
    fixture: 'order-seller',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: 'Start the handover' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  // the action rows of the rail open these: a reason form, and the proposal of a place and a time (U11-16: the dialogs and cells the first states did not show)
  {
    name: 'order-seller-cancel-popup',
    fixture: 'order-seller',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: 'Cancel this order' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  // the confirm dialogs (U11-17): closing an account, blocking someone in a chat, cancelling an order after its reason
  {
    name: 'privacy-close-confirm',
    fixture: 'privacy-seller',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: 'Close my account' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    name: 'thread-block-confirm',
    fixture: 'thread-seller',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: /^Block / }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    name: 'order-seller-cancel-confirm',
    fixture: 'order-seller',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: 'Cancel this order' }).click();
      await page.getByRole('dialog').getByLabel('Reason').fill('The item is no longer available.');
      await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: /^Cancel and refund/ }).waitFor();
    },
  },
  {
    name: 'order-seller-propose-popup',
    fixture: 'order-seller',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: 'Propose a place and time' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  // the courier, dispute and return cells (U11-19), from fixtures made by derive-fixtures.mjs: the pay panel's choice, the dispute cell and the seller's return step
  {
    name: 'order-buyer-courier-popup',
    fixture: 'order-buyer-pay',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: /Courier to my address/ }).click();
      await page.getByRole('dialog').waitFor();
      // the saved addresses arrive after the dialog opens, and the page's clock is paused: let it run until the row is there (a slow machine needs more turns)
      for (let turns = 0; turns < 40 && !(await page.getByText(/Home: House 12/).isVisible()); turns++) await page.clock.runFor(250);
      await page.getByText(/Home: House 12/).waitFor({ timeout: 2_000 });
    },
  },
  {
    name: 'order-buyer-dispute-popup',
    fixture: 'order-buyer-dispute',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: 'Open a dispute' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  {
    name: 'dispute-seller-return-popup',
    fixture: 'dispute-seller-return',
    open: async (page: import('@playwright/test').Page) => {
      await page.getByRole('button', { name: 'Check the item' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
];
for (const state of STATES) {
  for (const theme of ['dark', 'light'] as const) {
    for (const width of [390, 1440]) {
      test(`${state.name} ${theme} ${width}`, async ({ page }) => {
        await openScreen(page, state.fixture, { theme, lang: 'en', width });
        await state.open(page);
        await page.clock.runFor(1_000); // the popup's own arrival has finished
        await expect(page).toHaveScreenshot(`${state.name}-${theme}-${width}.png`, { mask: volatile(page) });
      });
    }
  }
}
