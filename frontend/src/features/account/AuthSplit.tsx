// The split layout of sign-in and registration (Daylight design, docs/design/10_visual.md, section 7.8, AC-ACC-1):
// the form on the left; from 60rem a peach-cream side on the right with the payment promise as a price tag hanging
// on a laptop. On phones it is the form only (the side is not displayed).
import type { ReactNode } from 'react';
import { useAccountT } from './common';
import laptop from './signin-laptop.webp';
import styles from './account.module.css';

export function AuthSplit({ children }: { children: ReactNode }) {
  const { t } = useAccountT();
  return (
    <div className={styles.split}>
      <div className={styles.splitForm}>{children}</div>
      <div className={styles.splitSide}>
        <div className={styles.sideStage}>
          <img src={laptop} alt="" width={440} height={361} />
          <div className={styles.sideTag}>
            <p className={styles.sideTitle}>{t('side.promise_title')}</p>
            <p>{t('side.promise_text')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The line under the main button of sign-in and registration (AC-ACC-2): the human check is a short proof of work
 *  in the browser (SEC-ABU-02, shared/humanCheck.ts), never a puzzle. */
export function HumanCheckNote() {
  const { t } = useAccountT();
  return <p className={styles.humanCheck}>{t('human_check.note')}</p>;
}
