// The step-up dialog (SEC-AUTH-08; Unit 1 section 6.3). It starts the step-up for the action, asks for
// the code (an authenticator code or recovery code with MFA on, otherwise an SMS code), and hands the
// grant back to the waiting request. Native <dialog>: focus moves in, Escape cancels, and focus returns
// to where it was (section 7).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi } from './api';
import { untilAfter, untilServerTime, useSecondsLeft } from './countdown';
import { errorText } from './errors';
import { FormMessage, SubmitButton, TextField } from './form';
import { useLanguage } from './language/Language';
import { toAsciiDigits, toLocalDigits } from '../lib/money.js';
import { isApiError, problemName } from './problems';
import { StepUpCancelled, type StepUpRequest } from './stepUp';
import styles from './shell.module.css';

type Started = { method: 'totp' } | { method: 'sms'; resendAt?: string };

export function StepUpDialog({ request }: { request: StepUpRequest }) {
  const api = useApi();
  const { t, lang } = useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const startedFor = useRef<StepUpRequest | null>(null);
  const [started, setStarted] = useState<Started | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState<number | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const resendIn = useSecondsLeft(resendUntil);
  const waitFor = useSecondsLeft(waitUntil);

  const start = async () => {
    setError(null);
    try {
      const s: Started = await api.post('/auth/step-up/start', { action: request.action });
      setStarted(s);
      setResendUntil(s.method === 'sms' && s.resendAt ? untilServerTime(s.resendAt) : null);
    } catch (e) {
      if (isApiError(e, 429)) setResendUntil(untilAfter(e.retryAfter ?? 60));
      setError(errorText(e, t, lang));
    }
  };

  useEffect(() => {
    if (startedFor.current !== request) opener.current = document.activeElement;
    const d = dialog.current;
    if (d && typeof d.showModal === 'function' && !d.open) d.showModal();
    else d?.setAttribute('open', '');
    // Started once per request, also when development mode runs this effect twice: a second start
    // would send a second SMS code.
    if (startedFor.current !== request) {
      startedFor.current = request;
      void start();
    }
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [request]); // once per request

  const cancel = () => request.reject(new StepUpCancelled());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r: { grant: string } = await api.post('/auth/step-up/verify', { action: request.action, code: toAsciiDigits(code).trim() });
      request.resolve(r.grant);
    } catch (err) {
      const name = problemName(err);
      if (isApiError(err, 429)) setWaitUntil(untilAfter(err.retryAfter ?? 60));
      setError(name === 'otp-failed' || name === 'mfa-failed' ? t('stepup.wrong_code')
        : name === 'otp-expired' ? t('stepup.expired') : errorText(err, t, lang));
      setBusy(false);
    }
  };

  const instruction = started?.method === 'totp' ? t('stepup.totp') : started?.method === 'sms' ? t('stepup.sms') : t('shell.loading');
  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="stepup-title"
      onCancel={(e) => { e.preventDefault(); cancel(); }}>
      <form onSubmit={submit}>
        <h2 id="stepup-title">{t('stepup.title')}</h2>
        <p>{instruction}</p>
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <TextField id="stepup-code" label={t('stepup.code_label')} value={code} onChange={setCode}
          autoComplete="one-time-code" inputMode={started?.method === 'sms' ? 'numeric' : 'text'} autoFocus
          maxLength={40} required />
        <div className={styles.dialogActions}>
          <SubmitButton busy={busy} disabled={!started || waitFor > 0}>
            {waitFor > 0 ? t('stepup.wait', { seconds: toLocalDigits(String(waitFor), lang) }) : t('stepup.confirm')}
          </SubmitButton>
          {started?.method === 'sms' && (
            <button type="button" onClick={() => void start()} disabled={resendIn > 0}>
              {resendIn > 0 ? t('stepup.resend_in', { seconds: toLocalDigits(String(resendIn), lang) }) : t('stepup.resend')}
            </button>
          )}
          <button type="button" onClick={cancel}>{t('stepup.cancel')}</button>
        </div>
      </form>
    </dialog>
  );
}
