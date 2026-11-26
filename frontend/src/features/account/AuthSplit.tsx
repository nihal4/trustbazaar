// The fresh page of sign-in and registration (U10-25, redesign v3): the whole screen is the animated, pointer-aware field of hairline squares
// (GridCanvas) and the form sits in the middle in one ruled card, with the payment promise in a ruled line under it. The page has no header, search,
// notices or footer (shared/Shell.tsx, BARE_PATHS); the logo and the language switch are in its corners.
import type { ReactNode } from 'react';
import { useAccountT } from './common';
import { GridCanvas } from './GridCanvas';
import styles from './account.module.css';

export function AuthSplit({ children }: { children: ReactNode }) {
  const { t } = useAccountT();
  return (
    <div className={styles.stage}>
      <GridCanvas />
      <div className={styles.stageCard}>
        {children}
        <p className={styles.stageNote}><strong>{t('side.promise_title')}</strong> {t('side.promise_text')}</p>
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
