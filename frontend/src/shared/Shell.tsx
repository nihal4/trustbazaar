// The frame of every page of the user app, the console and the KYC page (section 3; section 7):
// a skip link, the header with the language switch, the signed-out notice and the main region.
// After a navigation, focus moves to the main region so keyboard and screen-reader users start at
// the new page.
import { Suspense, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useLanguage } from './language/Language';
import { LanguageSwitch } from './language/LanguageSwitch';
import { useMe } from './me';
import { useSignedOut } from './session';
import { usePendingStepUp } from './stepUp';
import { StepUpDialog } from './StepUpDialog';
import styles from './shell.module.css';

export interface ShellProps {
  /** the console and the KYC page name themselves next to the logo */
  titleKey?: string;
  /** the logo's target; a path of another document is a normal page load */
  home: { path: string; sameDocument: boolean };
  /** the user app shows "Sign in" or "Account" in the header */
  accountLinks?: boolean;
}

export function Shell({ titleKey, home, accountLinks = false }: ShellProps) {
  const { t } = useLanguage();
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const shownPath = useRef(pathname);

  useEffect(() => {
    if (shownPath.current === pathname) return;   // first render (also when StrictMode runs it twice)
    shownPath.current = pathname;
    main.current?.focus();
  }, [pathname]);

  const brand = 'TrustBazaar';
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">{t('shell.skip_to_content')}</a>
      <header className={styles.header}>
        {home.sameDocument
          ? <Link className={styles.brand} to={home.path} aria-label={t('shell.home_link')}>{brand}</Link>
          : <a className={styles.brand} href={home.path} aria-label={t('shell.home_link')}>{brand}</a>}
        {titleKey && <span className={styles.docTitle}>{t(titleKey)}</span>}
        <span className={styles.spacer} />
        {accountLinks && <AccountLink />}
        <LanguageSwitch />
      </header>
      <SignedOutNotice />
      <PendingStepUp />
      <main id="main" ref={main} tabIndex={-1} className={styles.main}>
        <Suspense fallback={<p role="status">{t('shell.loading')}</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
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

/** "Account" once /me answers; otherwise "Sign in", returning to this page. */
function AccountLink() {
  const { t } = useLanguage();
  const me = useMe();
  const { pathname, search } = useLocation();
  if (me.isSuccess) return <Link className={styles.account} to="/account">{t('shell.account')}</Link>;
  if (pathname === '/signin' || pathname === '/register') return null;
  return <Link className={styles.account} to={`/signin?next=${encodeURIComponent(pathname + search)}`}>{t('shell.sign_in')}</Link>;
}

function PendingStepUp() {
  const pending = usePendingStepUp();
  return pending ? <StepUpDialog key={pending.action} request={pending} /> : null;
}
