// The privacy notice shown before any personal data is collected (FR-PRV-01): purposes, the data
// collected, how long it is kept (SRS retention table), who receives it, where it is stored, and how
// to withdraw consent. A draft for team and legal review (Decisions log, U8-02); /help/privacy shows
// the same text.
import { Link } from 'react-router-dom';
import { useAccountT } from './common';
import styles from './account.module.css';

const POINTS = ['purposes', 'data', 'retention', 'recipients', 'location', 'rights'] as const;

/** The points of the notice, shared by the register screen and /help/privacy. */
export function PrivacyPoints() {
  const { t } = useAccountT();
  return (
    <dl>
      {POINTS.map((p) => (
        <div key={p}>
          <dt>{t(`privacy.${p}.title`)}</dt>
          <dd>{t(`privacy.${p}.text`)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PrivacyNotice() {
  const { t } = useAccountT();
  return (
    <section className={styles.notice} aria-labelledby="privacy-notice-title">
      <h2 id="privacy-notice-title">{t('privacy.title')}</h2>
      <PrivacyPoints />
      <p>
        <Link to="/help/privacy">{t('privacy.full_notice')}</Link>
        {' · '}
        <Link to="/help/terms">{t('privacy.terms')}</Link>
      </p>
    </section>
  );
}
