// The two help pages the register screen links to (section 3.3, /help/:topic): the privacy notice and
// the terms and conditions (legalText.ts), as static text in both languages. Both are drafts for the team's and a legal review
// before release (Decisions log, U8-02). The other help topics arrive with their features.
import { Link } from 'react-router-dom';
import { toLocalDigits } from '../../lib/money.js';
import { useAccountT } from './common';
import { LEGAL_VERSIONS } from './legal';
import { TermsBody } from './LegalDocs';
import { PrivacyPoints } from './PrivacyNotice';
import styles from './account.module.css';

export function PrivacyPage() {
  const { t, lang } = useAccountT();
  return (
    <article className={styles.narrow} aria-labelledby="help-title">
      <h1 id="help-title">{t('privacy.title')}</h1>
      <p className={styles.version}>{t('help.version', { version: toLocalDigits(LEGAL_VERSIONS.privacy, lang) })}</p>
      <PrivacyPoints />
      <p><Link to="/help/terms">{t('privacy.terms')}</Link></p>
    </article>
  );
}

export function TermsPage() {
  const { t, lang } = useAccountT();
  return (
    <article className={styles.narrow} aria-labelledby="help-title">
      <h1 id="help-title">{t('privacy.terms')}</h1>
      <p className={styles.version}>{t('help.version', { version: toLocalDigits(LEGAL_VERSIONS.terms, lang) })}</p>
      <TermsBody />
      <p><Link to="/help/privacy">{t('privacy.full_notice')}</Link></p>
    </article>
  );
}
