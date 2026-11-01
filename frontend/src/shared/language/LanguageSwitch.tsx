// The switch in the header of every page (NFR-USE-04). It names the other language in that language,
// so a reader of either can find it; its accessible name says what it does.
import { otherLang } from './lang';
import { useLanguage } from './Language';
import styles from '../shell.module.css';

export function LanguageSwitch() {
  const { lang, setLang, t } = useLanguage();
  const other = otherLang(lang);
  return (
    <button type="button" className={styles.langSwitch} aria-label={t('shell.language.switch_label')}
      onClick={() => setLang(other)}>
      <span lang={other}>{t('shell.language.other')}</span>
    </button>
  );
}
