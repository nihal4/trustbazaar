import { formatWait } from '../../shared/wait';
import { Suspense, useState, type FormEvent } from 'react';
import { toAsciiDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { CodeField, SubmitButton } from '../../shared/form';
import { problemName } from '../../shared/problems';
import { otherError, retryAfter, useAccountT } from './common';
import { isSixDigits } from './input';
import styles from './account.module.css';
import { QrCode, wrongCode, groupSecret, Stepper, CopyButton } from './mfaShared';

export function Enrol({
  otpauthUri,
  secret,
  onDone,
  onCancel,
  onStateChanged,
}: {
  otpauthUri: string;
  secret: string;
  onDone: (codes: string[]) => void;
  onCancel: () => void;
  onStateChanged: () => void;
}) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

  const confirm = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!isSixDigits(code)) {
      setError(t('mfa.code_six'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r: { recoveryCodes: string[] } = await api.post('/me/mfa/totp/confirm', { code: toAsciiDigits(code).trim() });
      onDone(r.recoveryCodes);
    } catch (err) {
      const wait = retryAfter(err);
      const name = problemName(err);
      if (wait !== null) setWaitUntil(untilAfter(wait));
      else if (wrongCode(name)) setError(t('mfa.code_wrong'));
      else if (name === 'mfa-state') onStateChanged();
      else setError(otherError(err, t, lang));
      setBusy(false);
    }
  };

  const [step, setStep] = useState<1 | 2 | 3>(1);
  return (
    <div>
      <Stepper current={step} />
      {step === 1 && (
        <>
          <p>{t('mfa.step_app')}</p>
          <div className={styles.stepNav}>
            <button type="button" onClick={onCancel}>
              {t('mfa.cancel')}
            </button>
            <button type="button" className={styles.next} onClick={() => setStep(2)}>
              {t('mfa.next')}
            </button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <p>{t('mfa.step_scan')}</p>
          {/* the code beside its key: scan it, or copy the key, or open the link on this phone */}
          <div className={styles.scan}>
            <Suspense fallback={<p role="status">{t('shell.loading')}</p>}>
              <QrCode text={otpauthUri} label={t('mfa.qr_label')} />
            </Suspense>
            <div className={styles.scanKey}>
              <p>{t('mfa.manual')}</p>
              <p className={styles.secret} aria-label={t('mfa.secret_label')}>
                {groupSecret(secret)}
              </p>
              <div className={styles.actions}>
                <CopyButton text={secret.replace(/\s+/g, '')} label={t('mfa.copy_secret')} />
                <a href={otpauthUri} className={styles.linkButton}>
                  {t('mfa.open_app')}
                </a>
              </div>
            </div>
          </div>
          <div className={styles.stepNav}>
            <button type="button" onClick={() => setStep(1)}>
              {t('mfa.back')}
            </button>
            <button type="button" className={styles.next} onClick={() => setStep(3)}>
              {t('mfa.next')}
            </button>
          </div>
        </>
      )}
      {step === 3 && (
        <form onSubmit={confirm} noValidate>
          <CodeField
            id="mfa-confirm-code"
            label={t('mfa.first_code')}
            hint={t('mfa.first_code_hint')}
            value={code}
            onChange={setCode}
            error={error ?? undefined}
            autoFocus
            data-autofocus
          />
          <div className={styles.stepNav}>
            <button type="button" onClick={() => setStep(2)} disabled={busy}>
              {t('mfa.back')}
            </button>
            <SubmitButton busy={busy} disabled={waitFor > 0}>
              {waitFor > 0 ? t('wait.seconds', { time: formatWait(waitFor, lang) }) : t('mfa.confirm')}
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
