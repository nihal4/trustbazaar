// The frame of every page of the user app, the console and the KYC page (section 3; section 7; Daylight design,
// docs/design/10_visual.md, section 6): a skip link, the header with the logo and the language switch, the
// signed-out notice and the main region; in the user app also the footer and, on phones, the tab bar.
// After a navigation, focus moves to the main region so keyboard and screen-reader users start at
// the new page.
import { Suspense, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { BellIcon, ChatIcon, HomeIcon, OrdersIcon, PlusIcon, SearchIcon, UserIcon } from './icons';
import { Logo } from './Logo';
import { useLanguage } from './language/Language';
import { LanguageSwitch } from './language/LanguageSwitch';
import { ME_KEY, useMe } from './me';
import { useLive } from './live';
import { useLanguageSync, useUnreadCount } from './notifications';
import { useSignedOut } from './session';
import { usePendingStepUp } from './stepUp';
import { StepUpDialog } from './StepUpDialog';
import { toLocalDigits } from '../lib/money.js';
import styles from './shell.module.css';

export interface ShellProps {
  /** the console and the KYC page name themselves next to the logo */
  titleKey?: string;
  /** the logo's target; a path of another document is a normal page load */
  home: { path: string; sameDocument: boolean };
  /** the user app shows "Sign in" or "Account" in the header */
  accountLinks?: boolean;
  /** a way out of a focused document (the KYC wizard's "Finish later"), a normal page load */
  exit?: { href: string; labelKey: string };
}

/** U10-25: sign-in, registration and the pages of a forgotten password or a link are one fresh page: no header, search, notices, footer or tab bar. */
const BARE_PATHS = new Set(['/signin', '/register', '/reset', '/reset-password', '/verify-email']);

export function Shell({ titleKey, home, accountLinks = false, exit }: ShellProps) {
  const { t } = useLanguage();
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const shownPath = useRef(pathname);

  useEffect(() => {
    if (shownPath.current === pathname) return;   // first render (also when StrictMode runs it twice)
    shownPath.current = pathname;
    main.current?.focus();
  }, [pathname]);

  // Phones get the tab bar instead of the header's links; decided once on the first render, so nothing jumps.
  const phone = useMediaQuery('(max-width: 47.99em)', false, { getInitialValueInEffect: false });
  const tabs = accountLinks && phone;
  if (accountLinks && BARE_PATHS.has(pathname)) {
    return (
      <div className={styles.bare}>
        <a className={styles.skip} href="#main">{t('shell.skip_to_content')}</a>
        <header className={styles.bareTop}>
          <Link className={styles.brand} to={home.path} aria-label={t('shell.home_link')}><Logo onDark /></Link>
          <LanguageSwitch />
        </header>
        <main id="main" ref={main} tabIndex={-1} className={styles.bareMain}>
          <Suspense fallback={<p role="status">{t('shell.loading')}</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    );
  }
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">{t('shell.skip_to_content')}</a>
      {accountLinks && <p className={styles.promiseBar}><ShieldIcon /><span className={styles.promiseLong}>{t('shell.promise_bar')}</span><span className={styles.promiseShort}>{t('shell.promise_bar_short')}</span></p>}
      <header className={exit ? `${styles.header} ${styles.withExit}` : styles.header}>
        {home.sameDocument
          ? <Link className={styles.brand} to={home.path} aria-label={t('shell.home_link')}><Logo onDark={accountLinks} /></Link>
          : <a className={styles.brand} href={home.path} aria-label={t('shell.home_link')}><Logo onDark={accountLinks} /></a>}
        {titleKey && <span className={styles.docTitle}>{t(titleKey)}</span>}
        {accountLinks && !phone && pathname !== '/' && pathname !== '/search' ? <><HeaderSearch /><span className={styles.spacerSmall} /></> : <span className={styles.spacer} />}
        {accountLinks && <AccountLink phone={phone} />}
        {!accountLinks && <LanguageSwitch />}
        {exit && <a className={styles.exit} href={exit.href}>{t(exit.labelKey)}</a>}
        {accountLinks && !phone && <Button component={Link} to="/sell/new">{t('shell.sell')}</Button>}
      </header>
      <SignedOutNotice />
      <PendingStepUp />
      <LiveConnection />
      <main id="main" ref={main} tabIndex={-1} className={tabs ? `${styles.main} ${styles.withTabs}` : styles.main}>
        <Suspense fallback={<p role="status">{t('shell.loading')}</p>}>
          <Outlet />
        </Suspense>
      </main>
      {accountLinks && <Footer />}
      {tabs && <TabBar />}
    </div>
  );
}

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M12 2.8 4.5 5.7v5.6c0 4.7 3.1 8.4 7.5 9.9 4.4-1.5 7.5-5.2 7.5-9.9V5.7Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <path d="m8.8 12.1 2.3 2.3 4.3-4.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The search in the header of the user app on wide screens: a pill that goes to /search with the words in the URL. */
function HeaderSearch() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [words, setWords] = useState('');
  const go = (e: FormEvent) => {
    e.preventDefault();
    const q = words.trim();
    void navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };
  return (
    <form role="search" aria-label={t('shell.search_label')} className={styles.headSearch} onSubmit={go}>
      <label htmlFor="head-q" className={styles.visuallyHidden}>{t('shell.search_label')}</label>
      <SearchIcon />
      <input id="head-q" type="search" maxLength={100} value={words} placeholder={t('shell.search_placeholder')} onChange={(e) => setWords(e.target.value)} />
    </form>
  );
}

/** The user app's footer: what the site is, and the help pages. */
function Footer() {
  const { t } = useLanguage();
  return (
    <footer className={styles.footer}>
      <div className={styles.footerGrid}>
        <div className={styles.footerAbout}>
          <Logo onDark />
          <p>{t('shell.footer.tagline')}</p>
        </div>
        <nav className={styles.footerCol} aria-labelledby="footer-explore">
          <p id="footer-explore" className={styles.footerLabel}>{t('shell.footer.explore')}</p>
          <ul className={styles.footerLinks}>
            <li><Link to="/search">{t('shell.tab.search')}</Link></li>
            <li><Link to="/sell/new">{t('shell.sell')}</Link></li>
          </ul>
        </nav>
        <nav className={styles.footerCol} aria-labelledby="footer-help">
          <p id="footer-help" className={styles.footerLabel}>{t('shell.footer.help')}</p>
          <ul className={styles.footerLinks}>
            <li><Link to="/help/terms">{t('shell.footer.terms')}</Link></li>
            <li><Link to="/help/privacy">{t('shell.footer.privacy')}</Link></li>
          </ul>
        </nav>
      </div>
      <div className={styles.footerLang}>
        <span id="footer-language" className={styles.footerLabel}>{t('shell.footer.language')}</span>
        <LanguageSwitch />
      </div>
    </footer>
  );
}

/** On phones: the five places people go most, at the bottom where thumbs reach (Daylight design, section 6). */
function TabBar() {
  const { t } = useLanguage();
  const me = useMe();
  const tab = (to: string, icon: JSX.Element, label: string, end = false) => (
    <li><NavLink to={to} end={end} className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabOn}` : styles.tab)}>{icon}<span className={styles.tabLabel}>{label}</span></NavLink></li>
  );
  return (
    <nav className={styles.tabBar} aria-label={t('shell.tabs.label')}>
      <ul>
        {tab('/', <HomeIcon />, t('shell.tab.home'), true)}
        {tab('/search', <SearchIcon />, t('shell.tab.search'))}
        <li><NavLink to="/sell/new" className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabHot} ${styles.tabOn}` : `${styles.tab} ${styles.tabHot}`)}><span className={styles.tabSell}><PlusIcon /></span><span className={styles.tabLabel}>{t('shell.tab.sell')}</span></NavLink></li>
        {me.isSuccess && tab('/messages', <ChatIcon />, t('shell.messages'))}
        {me.isSuccess && tab('/orders', <OrdersIcon />, t('shell.orders'))}
      </ul>
    </nav>
  );
}

function SignedOutNotice() {
  const { t } = useLanguage();
  const [signedOut, dismiss] = useSignedOut();
  if (!signedOut) return null;
  return (
    <div role="alert" className={styles.notice}>
      <p>{t('error.session_ended')}</p>
      <button type="button" onClick={dismiss}>{t('shell.close')}</button>
    </div>
  );
}

/**
 * "Account" and the notifications once /me answers; otherwise "Sign in", returning to this page. On phones the
 * header keeps only the notifications and the account, as icons with their names; the tab bar has the rest.
 */
function AccountLink({ phone }: { phone: boolean }) {
  const { t } = useLanguage();
  const me = useMe();
  const unread = useUnreadCount();
  useLanguageSync();
  const { pathname, search } = useLocation();
  if (me.isSuccess && phone) {
    return (
      <>
        <NotificationsLink unread={unread} icon />
        <Link className={styles.iconLink} to="/account"><UserIcon /><span className={styles.visuallyHidden}>{t('shell.account')}</span></Link>
      </>
    );
  }
  if (me.isSuccess) {
    return (
      <div className={styles.navGrid}>
        <Link className={styles.navCell} to="/orders" title={t('shell.orders')}><OrdersIcon /><span className={styles.visuallyHidden}>{t('shell.orders')}</span></Link>
        <Link className={styles.navCell} to="/messages" title={t('shell.messages')}><ChatIcon /><span className={styles.visuallyHidden}>{t('shell.messages')}</span></Link>
        <NotificationsLink unread={unread} icon cell />
        <Link className={styles.navCell} to="/account" title={t('shell.account')}><UserIcon /><span className={styles.visuallyHidden}>{t('shell.account')}</span></Link>
      </div>
    );
  }
  if (pathname === '/signin' || pathname === '/register') return null;
  return <Link className={styles.account} to={`/signin?next=${encodeURIComponent(pathname + search)}`}>{t('shell.sign_in')}</Link>;
}

function PendingStepUp() {
  const pending = usePendingStepUp();
  return pending ? <StepUpDialog key={pending.action} request={pending} /> : null;
}

/** The notification centre, with the unread count in words as well as a number (not colour alone). */
function NotificationsLink({ unread, icon = false, cell = false }: { unread: number | null; icon?: boolean; cell?: boolean }) {
  const { t, lang } = useLanguage();
  const n = unread ?? 0;
  const count = toLocalDigits(String(n > 99 ? 99 : n), lang) + (n > 99 ? '+' : '');
  const label = t('shell.notifications_unread');
  return (
    // The name is the visible text, the count in words after it (WCAG 2.5.3, Label in Name).
    <Link className={cell ? styles.navCell : icon ? styles.iconLink : styles.account} to="/notifications" title={cell ? t('shell.notifications') : undefined}>
      {icon ? <><BellIcon /><span className={styles.visuallyHidden}>{t('shell.notifications')}</span></> : t('shell.notifications')}
      {n > 0 && <>{' '}<span className={styles.badge}>{count}</span><span className={styles.visuallyHidden}>{label}</span></>}
    </Link>
  );
}

/** The live connection follows the session: open while /me answers, closed after (section 5). User app only. */
function LiveConnection() {
  const live = useLive();
  return live ? <SessionLive live={live} /> : null;
}

function SessionLive({ live }: { live: NonNullable<ReturnType<typeof useLive>> }) {
  // follows the account the header has loaded (GET /me), without asking for it again
  const queryClient = useQueryClient();
  const signedIn = useSyncExternalStore(
    (changed) => queryClient.getQueryCache().subscribe(changed),
    () => queryClient.getQueryData(ME_KEY) !== undefined,
  );
  useEffect(() => {
    if (signedIn) live.start();
    else live.stop();
  }, [live, signedIn]);
  useEffect(() => () => live.stop(), [live]);
  return null;
}
