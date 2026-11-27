// Changing the mobile number on the security page: a code to the new number, then the change, behind step-up (FR-ACC-09).
import { formatWait } from '../../shared/wait';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { untilAfter, untilServerTime, useSecondsLeft } from '../../shared/countdown';
import { CodeField, FormMessage, SubmitButton, TextField } from '../../shared/form';
import { ME_KEY } from '../../shared/me';
import { problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { otherError, retryAfter, useAccountT } from './common';
import { bangladeshiMobile, isSixDigits } from './input';
import styles from './account.module.css';
import { withStepUp } from './securityShared';

export function PhoneForm() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendUntil, setResendUntil] = useState<number | null>(null);
  const resendIn = useSecondsLeft(resendUntil);

  const start = async (ev?: FormEvent) => {
    ev?.preventDefault();
    if (busy) return;
    const p = bangladeshiMobile(phone);
    if (!p) {
      setError(t('field.phone_invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await withStepUp(() => api.post('/me/phone/change', { phone: p }, { stepUpAction: 'phone.change' }) as Promise<{ resendAt: string }>);
      if (r !== 'cancelled') {
        setSentTo(p);
        setResendUntil(untilServerTime(r.resendAt));
      }
    } catch (err) {
      const wait = retryAfter(err);
      if (wait !== null) setResendUntil(untilAfter(wait));
      if (problemName(err) === 'contact-unavailable') setError(t('contact.unavailable'));
      else if (problemName(err) === 'validation-failed') setError(t('field.phone_invalid'));
      else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  const verify = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!isSixDigits(code)) {
      setError(t('code.six_digits'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/me/phone/change/verify', { code: toAsciiDigits(code).trim() });
      setSentTo(null);
      setPhone('');
      setCode('');
      setMessage({ kind: 'success', text: t('contact.phone_changed') });
      await queryClient.invalidateQueries({ queryKey: ME_KEY });
    } catch (err) {
      const name = problemName(err);
      if (name === 'otp-failed') setError(t('code.wrong'));
      else if (name === 'otp-expired') setError(t('code.expired'));
      else if (name === 'contact-unavailable') {
        setSentTo(null);
        setError(t('contact.unavailable'));
      } else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      {sentTo === null ? (
        <form onSubmit={start} noValidate>
          <TextField
            id="phone-new"
            label={t('contact.new_phone')}
            hint={t('field.phone_hint')}
            value={phone}
            onChange={setPhone}
            error={error ?? undefined}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
          <SubmitButton busy={busy} disabled={resendIn > 0}>
            {resendIn > 0 ? t('wait.seconds', { time: formatWait(resendIn, lang) }) : t('contact.phone_submit')}
          </SubmitButton>
        </form>
      ) : (
        <form onSubmit={verify} noValidate>
          <p>{t('register.code_sent', { phone: sentTo })}</p>
          <CodeField id="phone-code" label={t('code.label')} value={code} onChange={setCode} error={error ?? undefined} />
          <div className={styles.actions}>
            <SubmitButton busy={busy}>{t('contact.phone_verify')}</SubmitButton>
            <button type="button" disabled={resendIn > 0 || busy} onClick={() => void start()}>
              {resendIn > 0 ? t('code.resend_in', { time: formatWait(resendIn, lang) }) : t('code.resend')}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
