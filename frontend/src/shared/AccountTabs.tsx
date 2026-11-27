// The account sections as tabs (Daylight design, docs/design/10_visual.md, section 7.8, AC-ACC-3): profile, security (with MFA), notifications, messages and your data share one row of
// links, so these pages read as one place. They are links between routes, not panels: each section keeps its own address and the back button works. The current one is marked
// with aria-current by the router. The row is the Tabs primitive (ui/Tabs.tsx), which scrolls sideways on narrow phones, never the page, and brings the current tab into view.
import { NavLink, useLocation } from 'react-router-dom';
import type { T } from './language/catalogue';
import { Tab, Tabs } from './ui/Tabs';
import styles from './tabs.module.css';

const TABS = [
  { to: '/account', key: 'shell.account_tabs.profile', end: true },
  { to: '/account/security', key: 'shell.account_tabs.security', end: true },
  { to: '/notifications', key: 'shell.notifications', end: true },
  { to: '/messages', key: 'shell.messages', end: false },
  { to: '/account/privacy', key: 'shell.account_tabs.privacy', end: true },
] as const;

export function AccountTabs({ t }: { t: T }) {
  const { pathname } = useLocation();
  return (
    <Tabs label={t('shell.account_tabs.label')} watch={pathname} className={styles.spaced}>
      {TABS.map((tab) => (
        <Tab key={tab.to} as={NavLink} to={tab.to} end={tab.end}>
          {t(tab.key)}
        </Tab>
      ))}
    </Tabs>
  );
}
