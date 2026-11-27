// The main screens, each from its fixture (record.mjs), in both themes, at the phone (390 px) and the desktop (1440 px) width, in English; Bangla at 390 px for the text-heavy screens;
// and interactive states (an open popup). Screens and states are added to these lists as the clean-up reaches them (U11-02 onwards): a screen has to be in the net before it is changed.
import { expect, test } from '@playwright/test';
import { openScreen, volatile } from './harness';

const SCREENS = [
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

// Bangla has longer words and its own line height: the text-heavy screens at the phone width, dark
for (const screen of SCREENS.filter((s) => s.name !== 'order-seller')) {
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
