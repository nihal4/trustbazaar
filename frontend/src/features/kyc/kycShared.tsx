import { toLocalDigits } from '../../lib/money.js';
import { useKycT } from './common';
import { kycStepsOf, type ImageKind, type WizardStep } from './model';
import styles from './kyc.module.css';

export type Step = WizardStep;

/** The four steps above the camera (AC-KYC-1): done, now or still to come, in words as well. */
export function Steps({ step }: { step: Step }) {
  const { t, lang } = useKycT();
  return (
    <ol className={styles.steps} aria-label={t('steps.label')}>
      {kycStepsOf(step).map((s, i) => (
        <li key={s.key} className={styles[s.state]} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className={styles.dot} aria-hidden="true">
            {s.state === 'done' ? '' : toLocalDigits(String(i + 1), lang)}
          </span>
          <span>{t(`steps.${s.key}`)}</span>
          <span className={styles.visuallyHidden}>{t(`steps.state.${s.state}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/** The side panel (AC-KYC-3): the photo rules, and who sees the ID. The intro says the same, so it is not repeated there. */
export function Side() {
  const { t } = useKycT();
  return (
    <aside className={styles.side}>
      <section className={styles.rules} aria-labelledby="kyc-rules-title">
        <h2 id="kyc-rules-title">{t('side.rules_title')}</h2>
        <ul>
          {(['document', 'whole', 'light', 'time'] as const).map((k) => (
            <li key={k}>{t(`intro.${k}`)}</li>
          ))}
        </ul>
      </section>
      <section className={styles.private} aria-labelledby="kyc-private-title">
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false">
          <path d="M10 1.5 L17 4.2 V9.4 C17 13.6 14 17 10 18.5 C6 17 3 13.6 3 9.4 V4.2 Z" fill="currentColor" />
          <path d="M6.8 10 l2.2 2.2 l4.2 -4.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <h2 id="kyc-private-title">{t('side.private_title')}</h2>
          <p>{t('intro.privacy')}</p>
        </div>
      </section>
      <p className={styles.after}>{t('side.after')}</p>
    </aside>
  );
}

export const isImage = (s: Step): s is ImageKind => s !== 'intro' && s !== 'details' && s !== 'review';
