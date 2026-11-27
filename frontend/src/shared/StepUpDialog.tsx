// The step-up dialog (SEC-AUTH-08; Unit 1 section 6.3). It starts the step-up for the action, asks for
// the code (an authenticator code or recovery code with MFA on, otherwise an SMS code), and hands the
// grant back to the waiting request. It is the shared Popup (a sheet over a blurred page, ruled buttons): focus moves in,
// Escape cancels, and focus returns to where it was (section 7). It never stands on another popup: a page that asks for a
// step-up hides its own popup until the answer (U10-25).
import { formatWait } from './wait';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApi } from './api';
import { untilAfter, untilServerTime, useSecondsLeft } from './countdown';
import { errorText } from './errors';
import { CodeField, FormMessage } from './form';
import { useLanguage } from './language/Language';
import { toAsciiDigits } from '../lib/money.js';
import { isApiError, problemName } from './problems';
import { Popup, PopupActions } from './Popup';
import { StepUpCancelled, type StepUpRequest } from './stepUp';

type Started = { method: 'totp' } | { method: 'sms'; resendAt?: string };

export function StepUpDialog({ request }: { request: StepUpRequest }) {
  const api = useApi();
  const { t, lang } = useLanguage();
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
    // Started once per request, also when development mode runs this effect twice: a second start
    // would send a second SMS code.
    if (startedFor.current !== request) {
      startedFor.current = request;
      void start();
    }
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

  // while the start has not been answered "Loading…" is said; when it was refused (a wait, for instance) the refusal alone is said, not both
  const instruction = started?.method === 'totp' ? t('stepup.totp') : started?.method === 'sms' ? t('stepup.sms') : error ? null : t('shell.loading');
  return (
    <Popup id="stepup" title={t("stepup.title")} closeLabel={t("stepup.cancel")} decorativeClose isStepUp busy={busy} onClose={cancel}>
      <form onSubmit={submit}>
        {instruction && <p>{instruction}</p>}
        {error && <FormMessage kind="error">{error}</FormMessage>}
        <CodeField id="stepup-code" label={t('stepup.code_label')} value={code} onChange={setCode} data-autofocus required allowRecovery={started?.method !== 'sms'} />
        <PopupActions>
          <button type="submit" disabled={busy || !started || waitFor > 0} aria-busy={busy || undefined}>
            {waitFor > 0 ? t('stepup.wait', { time: formatWait(waitFor, lang) }) : t('stepup.confirm')}
          </button>
          {started?.method === 'sms' && (
            <button type="button" onClick={() => void start()} disabled={resendIn > 0}>
              {resendIn > 0 ? t('stepup.resend_in', { time: formatWait(resendIn, lang) }) : t('stepup.resend')}
            </button>
          )}
          <button type="button" onClick={cancel}>{t('stepup.cancel')}</button>
        </PopupActions>
      </form>
    </Popup>
  );
}
