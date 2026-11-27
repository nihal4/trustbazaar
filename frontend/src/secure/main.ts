// The credential document, secure.html (docs/design/08_frontend.pdf section 3.1; SEC-GAM-03; U8-07): three screens
// under /secure/orders/{id}/ (key, deliver, credentials), built from the DOM without React, features or shared code,
// with Unit 5's sealed.js, lib/api.js for Unit 1's cookies and CSRF, and their own catalogue. A session that has
// ended goes to sign-in and comes back here.
import { createApi } from '../lib/api.js';
import { createT } from '../lib/i18n.js';
import { loadKey, storeKey } from '../lib/sealed.js';
import libEn from '../lib/messages/en.json';
import libBn from '../lib/messages/bn.json';
import en from '../messages/en/secure.json';
import bn from '../messages/bn/secure.json';
import { credentialsScreen } from './credentials';
import { deliverScreen } from './deliver';
import { h, show, tick } from './dom';
import { errorText, type Ctx, type KeyStore, type Lang } from './context';
import { keyScreen } from './key';

const SCREENS = { key: keyScreen, deliver: deliverScreen, credentials: credentialsScreen } as const;
const ROUTE = /^\/secure\/orders\/([0-9a-f-]{36})\/(key|deliver|credentials)\/?$/i;
export const CATALOGUES = { en: { ...libEn, ...en }, bn: { ...libBn, ...bn } } as Record<Lang, Record<string, string>>;

export const browserKeys: KeyStore = { store: storeKey, load: loadKey };

export interface Options { fetch?: typeof fetch; keys?: KeyStore; strict?: boolean; now?: () => number; location?: { pathname: string; assign(url: string): void } }

/** Renders the screen of this address; the returned function stops the countdowns (tests). */
/** The theme switch of the page's own header (U10-28): this document loads no shared code, so it keeps its own small switch; the choice is the one the app keeps (tb-theme). */
function wireTheme(t: (key: string) => string): void {
  const button = document.getElementById('theme');
  const label = document.getElementById('theme-label');
  if (!button || !label) return;
  const set = () => { label.textContent = t(document.documentElement.dataset.theme === 'light' ? 'secure.theme.to_dark' : 'secure.theme.to_light'); };
  set();
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('tb-theme', next); } catch { /* blocked storage: the choice lasts for this visit */ }
    set();
  });
}

export async function start(root: HTMLElement, o: Options = {}): Promise<() => void> {
  const loc = o.location ?? window.location;
  const signIn = () => loc.assign(`/signin?next=${encodeURIComponent(loc.pathname)}`);
  const api = createApi({ ...(o.fetch ? { fetch: o.fetch } : {}), onSignedOut: signIn });
  let lang: Lang = 'en';
  try {
    const p = (await api.get('/me/notification-preferences')) as { language?: string };
    if (p.language === 'bn') lang = 'bn';
  } catch {
    // the default language; the screen's own request shows any real problem
  }
  document.documentElement.lang = lang;
  const t = createT(CATALOGUES[lang], { strict: o.strict ?? false });
  document.querySelector('.brand')?.setAttribute('aria-label', t('secure.home_link'));   // the static header's logo link
  if (lang === 'bn') {
    document.querySelector('.logoDark')?.setAttribute('src', '/brand/trustbazaar-bn-reversed.svg');
    document.querySelector('.logoLight')?.setAttribute('src', '/brand/trustbazaar-bn.svg');
  }
  wireTheme(t);
  const now = o.now ?? (() => Date.now());
  const m = ROUTE.exec(loc.pathname);
  if (!m) {
    show(root, h('h1', { tabindex: '-1' }, t('secure.not_found')), h('p', {}, h('a', { href: '/' }, t('secure.home'))));
    return () => {};
  }
  document.title = `${t(`secure.${m[2]}.title`)} · TrustBazaar`;
  const ctx: Ctx = { api, t, lang, orderId: m[1].toLowerCase(), root, keys: o.keys ?? browserKeys, now };
  try {
    await SCREENS[m[2] as keyof typeof SCREENS](ctx);
  } catch (e) {
    show(root, h('h1', { tabindex: '-1' }, t(`secure.${m[2]}.title`)), h('p', { class: 'error', role: 'alert' }, errorText(e, t)),
      h('p', {}, h('a', { href: `/orders/${ctx.orderId}` }, t('secure.back_to_order'))));
  }
  const timer = setInterval(() => tick(now), 1000);
  return () => clearInterval(timer);
}
