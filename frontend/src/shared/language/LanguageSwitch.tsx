// The switch in the header of every page (NFR-USE-04). It names the other language in that language,
// so a reader of either can find it; its accessible name says what it does.
import { otherLang } from './lang';
import { useLanguage } from './Language';
import styles from '../shell.module.css';

export function LanguageSwitch() {
  const { lang, setLang, t } = useLanguage();
  const other = otherLang(lang);
  return (
    // The name starts with the visible word, so speech input can say what it sees (WCAG 2.5.3, Label in Name).
    <button type="button" className={styles.langSwitch} onClick={() => setLang(other)}>
      <span lang={other}>{t('shell.language.other')}</span>
      <span className={styles.visuallyHidden}>{t('shell.language.switch_label')}</span>
    </button>
  );
}
