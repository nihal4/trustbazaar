// The account sections as tabs (Daylight design, docs/design/10_visual.md, section 7.8, AC-ACC-3): profile, security
// (with MFA), notifications, messages and your data share one row of links, so these pages read as one place. They
// are links between routes, not Mantine panels: each section keeps its own address and the back button works. The
// current one is marked with aria-current. The row scrolls sideways on its own on narrow phones, never the page,
// and the current tab is scrolled into view.
import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { T } from './language/catalogue';
import styles from './tabs.module.css';

const TABS = [
  { to: '/account', key: 'shell.account_tabs.profile', end: true },
  { to: '/account/security', key: 'shell.account_tabs.security', end: true },
  { to: '/notifications', key: 'shell.notifications', end: true },
  { to: '/messages', key: 'shell.messages', end: false },
  { to: '/account/privacy', key: 'shell.account_tabs.privacy', end: true },
] as const;

export function AccountTabs({ t }: { t: T }) {
  const row = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    const show = () => {
      const nav = row.current;
      const current = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (nav && current) nav.scrollLeft = Math.max(0, current.offsetLeft - nav.offsetLeft - 16);
    };
    show();
    // the tabs are wider or narrower once the web font has arrived: place the current one again then, so it is not left where the fallback font put it
    void document.fonts?.ready.then(show);
  }, [pathname]);
  return (
    <nav ref={row} aria-label={t('shell.account_tabs.label')} className={styles.tabs}>
      <ul>
        {TABS.map((tab) => (
          <li key={tab.to}>
            <NavLink to={tab.to} end={tab.end} className={({ isActive }) => (isActive ? `${styles.tab} ${styles.active}` : styles.tab)}>
              {t(tab.key)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
