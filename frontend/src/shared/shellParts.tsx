// The parts of the frame that only show something: the footer, the tab bar on phones and the unread count.
import { Link, NavLink } from 'react-router-dom';
import { ChatIcon, HomeIcon, OrdersIcon, PlusIcon, SearchIcon } from './icons';
import { Logo } from './Logo';
import { useLanguage } from './language/Language';
import { LanguageSwitch } from './language/LanguageSwitch';
import { ThemeSwitch } from './ThemeSwitch';
import { useMe } from './me';
import { useUnreadMessages } from './notifications';
import { useTheme } from './themeMode';
import { toLocalDigits } from '../lib/money.js';
import styles from './shell.module.css';

/** The number of unread messages on the messages link, in words as well as a number (not colour alone). */
export function UnreadCount({ n }: { n: number }) {
  const { t, lang } = useLanguage();
  const count = toLocalDigits(String(n > 99 ? 99 : n), lang) + (n > 99 ? '+' : '');
  return (
    <>
      <span className={styles.badge}>{count}</span>
      <span className={styles.visuallyHidden}>{t('shell.notifications_unread')}</span>
    </>
  );
}

/** The user app's footer: what the site is, and the help pages. */
export function Footer() {
  const { t } = useLanguage();
  const [theme] = useTheme();
  return (
    <footer className={styles.footer}>
      <div className={styles.footerGrid}>
        <div className={styles.footerAbout}>
          <Logo onDark={theme === 'dark'} />
          <p>{t('shell.footer.tagline')}</p>
        </div>
        <nav className={styles.footerCol} aria-labelledby="footer-explore">
          <p id="footer-explore" className={styles.footerLabel}>
            {t('shell.footer.explore')}
          </p>
          <ul className={styles.footerLinks}>
            <li>
              <Link to="/search">{t('shell.tab.search')}</Link>
            </li>
            <li>
              <Link to="/sell/new">{t('shell.sell')}</Link>
            </li>
          </ul>
        </nav>
        <nav className={styles.footerCol} aria-labelledby="footer-help">
          <p id="footer-help" className={styles.footerLabel}>
            {t('shell.footer.help')}
          </p>
          <ul className={styles.footerLinks}>
            <li>
              <Link to="/help/terms">{t('shell.footer.terms')}</Link>
            </li>
            <li>
              <Link to="/help/privacy">{t('shell.footer.privacy')}</Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className={styles.footerLang}>
        <span id="footer-language" className={styles.footerLabel}>
          {t('shell.footer.language')}
        </span>
        <span className={styles.headTools}>
          <ThemeSwitch />
          <LanguageSwitch />
        </span>
      </div>
    </footer>
  );
}

/** On phones: the five places people go most, at the bottom where thumbs reach (Daylight design, section 6). */
export function TabBar() {
  const { t } = useLanguage();
  const me = useMe();
  const unreadMessages = useUnreadMessages();
  const tab = (to: string, icon: JSX.Element, label: string, end = false, count: number | null = null) => (
    <li>
      <NavLink to={to} end={end} className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabOn}` : styles.tab)}>
        {icon}
        <span className={styles.tabLabel}>{label}</span>
        {count ? <UnreadCount n={count} /> : null}
      </NavLink>
    </li>
  );
  return (
    <nav className={styles.tabBar} aria-label={t('shell.tabs.label')}>
      <ul>
        {tab('/', <HomeIcon />, t('shell.tab.home'), true)}
        {tab('/search', <SearchIcon />, t('shell.tab.search'))}
        <li>
          <NavLink
            to="/sell/new"
            className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabHot} ${styles.tabOn}` : `${styles.tab} ${styles.tabHot}`)}
          >
            <span className={styles.tabSell}>
              <PlusIcon />
            </span>
            <span className={styles.tabLabel}>{t('shell.tab.sell')}</span>
          </NavLink>
        </li>
        {me.isSuccess && tab('/messages', <ChatIcon />, t('shell.messages'), false, unreadMessages)}
        {me.isSuccess && tab('/orders', <OrdersIcon />, t('shell.orders'))}
      </ul>
    </nav>
  );
}
