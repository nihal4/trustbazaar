// What the MFA steps share: the lazily loaded QR code, the secret grouped for reading, the wrong-code message, the numbered step marks and the copy button.
import { lazy, useEffect, useRef, useState } from 'react';
import { stepMark } from '../../shared/stepPhase';
import { digits, useAccountT } from './common';
import styles from './account.module.css';

export const QrCode = lazy(() => import('./QrCode'));

/**
 * A refused code: `otp-failed` (400) since Unit 1's fix #142; `mfa-failed` is the older name, kept so
 * the message is right either way (Decisions log, U8-12).
 */
export const wrongCode = (name: string | null) => name === 'otp-failed' || name === 'mfa-failed';

/** The secret as people read it: groups of four. */
export const groupSecret = (secret: string) =>
  secret
    .replace(/\s+/g, '')
    .match(/.{1,4}/g)
    ?.join(' ') ?? '';

/** The words and the mark of the copy button once it has tried: copied, or not. */
const copyKey = (ok: boolean) => (ok ? 'mfa.copied' : 'mfa.copy_failed');
const copyState = (ok: boolean | null) => {
  if (ok === null) return undefined;
  return ok ? 'ok' : 'failed';
};

/** Where the person is in turning the app on: four segments (the app, the code, the first code, the recovery codes), the present one named. */
export function Stepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  const { t, lang } = useAccountT();
  const names = ['install', 'scan', 'confirm', 'codes'] as const;
  return (
    <div className={styles.stepper}>
      <p className={styles.stepperText}>
        <strong>{t('mfa.step_of', { n: digits(current, lang), total: digits(4, lang) })}</strong> · {t(`mfa.stepper.${names[current - 1]}`)}
      </p>
      <ol aria-hidden="true">
        {names.map((n, i) => (
          <li key={n} data-state={stepMark(i + 1, current)} />
        ))}
      </ol>
    </div>
  );
}

/** Copy to the clipboard. The answer is the button's own words for two seconds (Copied, or Could not copy), in the room of the longer of the two, so nothing moves. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useAccountT();
  const [done, setDone] = useState<boolean | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    setDone(ok);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(null), 2000);
  };
  const answer = done === null ? null : t(copyKey(done));
  return (
    <button type="button" className={styles.copyButton} data-answer={copyState(done)} onClick={() => void copy()}>
      <span className={styles.copyWords} aria-hidden="true">
        <span style={{ visibility: done === null ? 'visible' : 'hidden' }}>{label}</span>
        <span style={{ visibility: done === null ? 'hidden' : 'visible' }}>{answer ?? t('mfa.copied')}</span>
      </span>
      <span className={styles.srOnly}>{label}</span>
      <span role="status" className={styles.srOnly}>
        {answer}
      </span>
    </button>
  );
}
