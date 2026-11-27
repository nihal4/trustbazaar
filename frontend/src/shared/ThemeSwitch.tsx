// The switch between the light and the dark theme (U10-28), in the header and in the footer next to the language. A ruled square button with the sun or the moon;
// its name says what it does ("Switch to light mode"), and it is a button, not a toggle that says "on".
import { useLanguage } from './language/Language';
import { useTheme } from './themeMode';
import styles from './shell.module.css';

export function ThemeSwitch({ className }: { className?: string }) {
  const { t } = useLanguage();
  const [mode, setMode] = useTheme();
  const toLight = mode === 'dark';
  return (
    <button type="button" className={className ? `${styles.themeSwitch} ${className}` : styles.themeSwitch} onClick={() => setMode(toLight ? 'light' : 'dark')}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {toLight
          ? <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" /></>
          : <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />}
      </svg>
      <span className={styles.visuallyHidden}>{t(toLight ? 'shell.theme.to_light' : 'shell.theme.to_dark')}</span>
    </button>
  );
}
