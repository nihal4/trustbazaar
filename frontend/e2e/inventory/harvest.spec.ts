// The inventory of the interface (U11-13): every screen of e2e/visual/screens.json is opened from its fixture, and each kind of component on it (buttons, links, fields, panels, fact lists,
// steppers, avatars, tags, notices, popups, tabs, tables) is measured as it is drawn: the same measurements are one variant. For each variant a cropped picture is kept. Output: docs/design/11_inventory/
// (parts/ and crops/); `node scripts/inventory/build-report.mjs` merges them into the page the user reads. Run it with `sh e2e/inventory/run.sh` (the pinned container, like the screenshot tests).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type Page } from '@playwright/test';
import { openScreen } from '../visual/harness';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.INVENTORY_OUT ?? join(here, '..', '..', '..', 'docs', 'design', '11_inventory');
const SCREENS: { name: string; path: string; session: string | null }[] = JSON.parse(readFileSync(join(here, '..', 'visual', 'screens.json'), 'utf8'));

// open states: where popups and confirmations live (a page-load picture does not show them)
const STATES: { name: string; screen: string; click: string }[] = [
  { name: 'handover-popup', screen: 'order-seller', click: 'Start the handover' },
  { name: 'propose-popup', screen: 'order-seller', click: 'Propose a place and time' },
  { name: 'cancel-confirm', screen: 'order-seller', click: 'Cancel this order' },
  { name: 'notifications-all', screen: 'notifications-seller', click: 'Show all notifications' },
  { name: 'report-popup', screen: 'thread-seller', click: 'Report this conversation' },
];

interface Variant {
  category: string;
  signature: Record<string, string | number>;
  count: number;
  screens: string[];
  classes: string[];
  text: string;
  id: string;
}

/** Runs in the page: measures every component of the categories, marks one example of each variant with data-inv and returns the variants. */
const measure = (screen: string) => {
  // colours are kept exactly as drawn (the report names them from the theme's tokens)
  const token = (c: string) => (c === 'rgba(0, 0, 0, 0)' ? 'none' : c);
  const wash = token;
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[aria-hidden="true"], dialog:not([open])');
  };
  const baseOf = (el: Element) => [...el.classList].map((c) => c.split('_')[1] ?? c).filter(Boolean);
  const box = (el: Element) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const side = (s: 'Top' | 'Right' | 'Bottom' | 'Left') =>
      parseFloat(cs[`border${s}Width` as 'borderTopWidth']) > 0 && cs[`border${s}Style` as 'borderTopStyle'] !== 'none'
        ? `${Math.round(parseFloat(cs[`border${s}Width` as 'borderTopWidth']))}px ${token(cs[`border${s}Color` as 'borderTopColor'])}`
        : '-';
    return { r, cs, side };
  };
  const found: Record<string, Map<string, { sig: Record<string, string | number>; els: Element[] }>> = {};
  const add = (category: string, el: Element, sig: Record<string, string | number>) => {
    const key = JSON.stringify(sig);
    const bucket = (found[category] ??= new Map());
    const entry = bucket.get(key) ?? { sig, els: [] };
    entry.els.push(el);
    bucket.set(key, entry);
  };

  // buttons and links
  for (const el of document.querySelectorAll('button, a[class], [role="button"], input[type="submit"], label[class*="attach"], label[class*="Attach"]')) {
    if (!visible(el) || el.closest('[class*="visuallyHidden"], [class*="srOnly"]') || /(^|_)skip_/.test(el.className?.toString() ?? '')) continue;
    const { r, cs, side } = box(el);
    const hasBorder = side('Top') !== '-' || side('Bottom') !== '-' || side('Left') !== '-';
    const bg = cs.backgroundColor !== 'rgba(0, 0, 0, 0)';
    const isButtonLike = el.tagName === 'BUTTON' || hasBorder || bg;
    const sig = isButtonLike
      ? {
          height: Math.round(r.height / 2) * 2,
          padX: Math.round(parseFloat(cs.paddingLeft)),
          border: `${side('Top')} / ${side('Left')}`,
          radius: cs.borderTopLeftRadius === '0px' ? 'square' : cs.borderTopLeftRadius,
          bg: wash(cs.backgroundColor),
          color: token(cs.color),
          weight: cs.fontWeight,
          size: Math.round(parseFloat(cs.fontSize)),
        }
      : { underline: cs.textDecorationLine.includes('underline') ? 'underlined' : 'plain', color: token(cs.color), weight: cs.fontWeight };
    add(isButtonLike ? 'button' : 'text link', el, sig);
  }
  // fields
  for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), select, textarea')) {
    if (!visible(el)) continue;
    const { r, cs, side } = box(el);
    add('field', el, {
      height: Math.round(r.height / 4) * 4,
      border: `${side('Top')} / ${side('Bottom')} / ${side('Left')}`,
      radius: cs.borderTopLeftRadius === '0px' ? 'square' : cs.borderTopLeftRadius,
      bg: wash(cs.backgroundColor),
    });
  }
  for (const el of document.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
    if (!visible(el)) continue;
    const { r, cs } = box(el);
    add('choice mark', el, { type: (el as HTMLInputElement).type, size: Math.round(r.width), appearance: cs.appearance, radius: cs.borderTopLeftRadius });
  }
  // panels, cards and sections
  for (const el of document.querySelectorAll('section, aside, [class*="panel" i], [class*="card" i], [class*="box" i]')) {
    if (!visible(el) || el.closest('dialog')) continue;
    const { r, cs, side } = box(el);
    if (r.height < 40) continue;
    add('panel', el, {
      top: side('Top'),
      bottom: side('Bottom'),
      sides: `${side('Left')} / ${side('Right')}`,
      radius: cs.borderTopLeftRadius === '0px' ? 'square' : cs.borderTopLeftRadius,
      bg: wash(cs.backgroundColor),
      padY: Math.round(parseFloat(cs.paddingTop)),
      padX: Math.round(parseFloat(cs.paddingLeft)),
    });
  }
  // fact lists, steppers
  for (const el of document.querySelectorAll('dl')) {
    if (!visible(el)) continue;
    const { cs, side } = box(el);
    const first = el.firstElementChild ? getComputedStyle(el.firstElementChild) : cs;
    add('fact list', el, {
      display: cs.display,
      top: side('Top'),
      borderBetween: first.borderBottomWidth !== '0px' || first.borderLeftWidth !== '0px' ? 'rules' : 'none',
      cols: cs.gridTemplateColumns.split(' ').length,
    });
  }
  for (const el of document.querySelectorAll('ol, ul')) {
    if (!visible(el) || !/(step|journey|stepper|progress)/i.test(el.className + (el.getAttribute('aria-label') ?? ''))) continue;
    const { r, cs } = box(el);
    add('stepper', el, {
      orientation: r.width > r.height ? 'horizontal' : 'vertical',
      display: cs.display,
      items: el.children.length,
      markers: getComputedStyle(el.firstElementChild!, '::before').content !== 'none' ? 'before' : 'none',
    });
  }
  // avatars, tags, notices
  for (const el of document.querySelectorAll('[class*="avatar" i], [class*="thumb" i], [class*="photo" i]')) {
    if (!visible(el)) continue;
    const { r, cs, side } = box(el);
    if (r.width > 140 || r.width < 20) continue;
    add('avatar or photo place', el, {
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      border: side('Top'),
      radius: cs.borderTopLeftRadius === '0px' ? 'square' : cs.borderTopLeftRadius,
      bg: cs.backgroundImage !== 'none' ? 'grid' : wash(cs.backgroundColor),
      color: token(cs.color),
    });
  }
  for (const el of document.querySelectorAll(
    '[class*="tag" i], [class*="badge" i], [class*="chip" i], [class*="count" i], [class*="tick" i], [class*="status" i]:not(section):not(div)',
  )) {
    if (!visible(el) || el.matches('button, a, input, section')) continue;
    const { r, cs, side } = box(el);
    if (r.height > 48) continue;
    add('tag, count or mark', el, {
      height: Math.round(r.height / 2) * 2,
      border: side('Top'),
      radius: cs.borderTopLeftRadius === '0px' ? 'square' : cs.borderTopLeftRadius,
      bg: wash(cs.backgroundColor),
      color: token(cs.color),
      size: Math.round(parseFloat(cs.fontSize)),
    });
  }
  for (const el of document.querySelectorAll(
    '[role="alert"], [role="status"], [class*="notice" i], [class*="warning" i], [class*="flag" i], [class*="message" i]:not(ul):not(li), [class*="error" i]',
  )) {
    if (!visible(el) || el.matches('button, a, input, li')) continue;
    const { r, cs, side } = box(el);
    if (r.height < 24) continue;
    add('notice', el, {
      left: side('Left'),
      border: side('Top'),
      radius: cs.borderTopLeftRadius === '0px' ? 'square' : cs.borderTopLeftRadius,
      bg: wash(cs.backgroundColor),
      color: token(cs.color),
    });
  }
  // popups, tabs, tables
  for (const el of document.querySelectorAll('dialog[open]')) {
    const { r, cs, side } = box(el);
    add('popup', el, {
      top: side('Top'),
      radius: cs.borderTopLeftRadius === '0px' ? 'square' : cs.borderTopLeftRadius,
      widthClass: r.width > 700 ? 'wide' : r.width > 480 ? 'medium' : 'narrow',
      bg: wash(cs.backgroundColor),
    });
  }
  for (const el of document.querySelectorAll('[role="tab"], [class*="tabs" i] a, [class*="tab" i] > a')) {
    if (!visible(el)) continue;
    const { r, cs, side } = box(el);
    add('tab or nav item', el, { height: Math.round(r.height / 2) * 2, bottom: side('Bottom'), bg: wash(cs.backgroundColor), weight: cs.fontWeight });
  }
  for (const el of document.querySelectorAll('table')) {
    if (!visible(el)) continue;
    const { cs, side } = box(el);
    add('table', el, { border: side('Top'), collapse: cs.borderCollapse });
  }

  const variants: Variant[] = [];
  let n = 0;
  for (const [category, bucket] of Object.entries(found)) {
    for (const { sig, els } of bucket.values()) {
      const example = els[0];
      const id = `${screen}-${n++}`;
      example.setAttribute('data-inv', id);
      variants.push({
        category,
        signature: sig,
        count: els.length,
        screens: [screen],
        id,
        classes: [...new Set(els.flatMap((e) => baseOf(e)))].slice(0, 6),
        text: (example.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      });
    }
  }
  return variants;
};

// one test for each screen and each open state, in parallel: a screen that fails to open does not stop the others, and each writes its own part (parts/<name>.json and crops/);
// `node scripts/inventory/build-report.mjs` merges the parts into one list of variants and the page the user reads
const look = { theme: 'dark' as const, lang: 'en' as const, width: 1440 };
test.describe.configure({ mode: 'parallel' });
test.beforeAll(() => {
  mkdirSync(join(OUT, 'crops'), { recursive: true });
  mkdirSync(join(OUT, 'parts'), { recursive: true });
});

async function harvest(page: Page, label: string) {
  const variants = await page.evaluate(measure, label);
  const parts = [];
  for (const v of variants) {
    let picture: string | null = null;
    try {
      const file = `${v.id}.png`;
      await page
        .locator(`[data-inv="${v.id}"]`)
        .first()
        .screenshot({ path: join(OUT, 'crops', file), timeout: 2500, animations: 'disabled' });
      picture = file;
    } catch {
      /* the example is hidden or moved: this variant has no picture from this screen */
    }
    parts.push({ ...v, picture });
  }
  writeFileSync(join(OUT, 'parts', `${label}.json`), JSON.stringify(parts, null, 2) + '\n');
}

for (const screen of SCREENS) {
  test(`screen ${screen.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openScreen(page, screen.name, look);
    await harvest(page, screen.name);
  });
}

for (const state of STATES) {
  test(`state ${state.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await openScreen(page, state.screen, look);
    await page
      .getByRole('button', { name: state.click })
      .or(page.getByRole('link', { name: state.click }))
      .first()
      .click({ timeout: 8000 });
    await page.getByRole('dialog').first().waitFor({ timeout: 5000 });
    await page.clock.runFor(1000);
    await harvest(page, state.name);
  });
}

test('state kyc-wizard and its calendar', async ({ page }) => {
  test.setTimeout(120_000);
  await openScreen(page, 'kyc-wizard', look, '/account/kyc/');
  await page.getByRole('button', { name: 'Start' }).click({ timeout: 8000 });
  await page.clock.runFor(1000);
  await harvest(page, 'kyc-wizard-details');
  await page.getByRole('button', { name: 'Choose a date' }).click({ timeout: 8000 });
  await page.getByRole('dialog').first().waitFor({ timeout: 5000 });
  await page.clock.runFor(1000);
  await harvest(page, 'kyc-calendar');
});
