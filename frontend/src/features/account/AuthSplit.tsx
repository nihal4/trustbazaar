// The split layout of sign-in and registration (U10-25, redesign v3): the form on the left on ruled fields; from 60rem a field of hairline squares on
// the right (GridField) with the payment promise in one ruled cell at its foot. On phones it is the form only (the side is not displayed).
import type { ReactNode } from 'react';
import { useAccountT } from './common';
import { GridField } from './GridField';
import styles from './account.module.css';

export function AuthSplit({ children }: { children: ReactNode }) {
  const { t } = useAccountT();
  return (
    <div className={styles.split}>
      <div className={styles.splitForm}>{children}</div>
      <div className={styles.splitSide}>
        <GridField />
        <div className={styles.sideNote}>
          <p className={styles.sideTitle}>{t('side.promise_title')}</p>
          <p>{t('side.promise_text')}</p>
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
