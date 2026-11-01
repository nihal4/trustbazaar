// Account security (IF-UI-01; FR-ACC-06, FR-ACC-08, FR-ACC-09, SEC-AUTH-11): the live sessions with
// device and last use, "this device" marked; ending sessions; password, mobile number and e-mail
// changes, each behind step-up (SEC-AUTH-08); the authenticator app and recovery codes (MfaSettings).
import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { untilAfter, untilServerTime, useSecondsLeft } from '../../shared/countdown';
import { FormMessage, SubmitButton, TextField } from '../../shared/form';
import { ME_KEY } from '../../shared/me';
import { isApiError, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { StepUpCancelled } from '../../shared/stepUp';
import { formatDateTime } from '../../lib/time.js';
import { toAsciiDigits } from '../../lib/money.js';
import { SignInPrompt } from './AccountPage';
import { MfaSettings } from './MfaSettings';
import { digits, otherError, passwordReasonText, rejectedPasswordReason, retryAfter, useAccountT } from './common';
import { bangladeshiMobile, isSixDigits, looksLikeEmail, PASSWORD } from './input';
import styles from './account.module.css';

interface SessionSummary {
  id: string;
  current: boolean;
  device: string | null;
  approxLocation: string | null;
  createdAt: string;
  lastSeenAt: string;
}

const SESSIONS_KEY = ['auth', 'sessions'] as const;

export function Component() {
  const { t } = useAccountT();
  const api = useApi();
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: ({ signal }) => api.get('/auth/sessions', { signal }) as Promise<SessionSummary[]>,
    staleTime: FRESHNESS.account,
    retry: false,
  });

  if (sessions.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (sessions.isError && isApiError(sessions.error, 401)) return <SignInPrompt next="/account/security" />;

  return (
    <div className={styles.narrow}>
      <h1>{t('security.title')}</h1>
      <Sessions list={sessions.data ?? []} error={sessions.isError ? sessions.error : null} />
      <PasswordChange />
      <MfaSettings sessionsKey={SESSIONS_KEY} />
      <PhoneChange />
      <EmailChange />
    </div>
  );
}

function Sessions({ list, error }: { list: SessionSummary[]; error: unknown }) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const run = async (id: string, call: () => Promise<{ ended?: number } | null>) => {
    if (busy) return;
    setBusy(id);
    setMessage(null);
    try {
      const r = await call();
      if (r && typeof r.ended === 'number') setMessage({ kind: 'success', text: t('sessions.ended_others', { count: digits(r.ended, lang) }) });
    } catch (err) {
      if (!isApiError(err, 404)) setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    }
  };

  const others = list.filter((s) => !s.current);
  return (
    <section aria-labelledby="sessions-title" className={styles.section}>
      <h2 id="sessions-title">{t('sessions.title')}</h2>
      {error !== null && <FormMessage kind="error">{otherError(error, t, lang)}</FormMessage>}
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <ul className={styles.sessions}>
        {list.map((s) => (
          <li key={s.id}>
            <p className={styles.device}>
              {s.device ?? t('sessions.unknown_device')}
              {s.current && <strong> · {t('sessions.this_device')}</strong>}
            </p>
            {s.approxLocation && <p>{s.approxLocation}</p>}
            <p>{t('sessions.last_used', { at: formatDateTime(Date.parse(s.lastSeenAt), lang) })}</p>
            <p>{t('sessions.started', { at: formatDateTime(Date.parse(s.createdAt), lang) })}</p>
            {!s.current && (
              <button type="button" disabled={busy !== null}
                onClick={() => void run(s.id, () => api.del(`/auth/sessions/${encodeURIComponent(s.id)}`))}>
                {t('sessions.end')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <button type="button" className={styles.secondary} disabled={busy !== null}
          onClick={() => void run('others', () => api.request('POST', '/auth/sessions/end-others'))}>
          {t('sessions.end_others')}
        </button>
      )}
    </section>
  );
}

/** Runs a change that needs step-up; a cancelled dialog is not an error. */
async function withStepUp<R>(call: () => Promise<R>): Promise<R | 'cancelled'> {
  try {
    return await call();
  } catch (e) {
    if (e instanceof StepUpCancelled) return 'cancelled';
    throw e;
  }
}

function PasswordChange() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const e: typeof errors = {};
    if (!current) e.current = t('password.current_required');
    if ([...next].length > PASSWORD.max) e.next = passwordReasonText('too-long', t, lang);
    else if ([...next].length < PASSWORD.minWithMfa) e.next = passwordReasonText('too-short', t, lang);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await withStepUp(() => api.post('/auth/password/change', { currentPassword: current, newPassword: next },
        { stepUpAction: 'password.change' }));
      if (r !== 'cancelled') {
        setCurrent('');
        setNext('');
        setMessage({ kind: 'success', text: t('password.changed') });
        await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });   // the others are shown as ended
      }
    } catch (err) {
      const reason = rejectedPasswordReason(err);
      if (reason) setErrors({ next: passwordReasonText(reason, t, lang) });
      else if (problemName(err) === 'password-incorrect') setErrors({ current: t('password.current_wrong') });
      else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="password-title" className={styles.section}>
      <h2 id="password-title">{t('password.change_title')}</h2>
      <p>{t('password.change_intro')}</p>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <form onSubmit={submit} noValidate>
        <TextField id="password-current" label={t('password.current')} value={current} onChange={setCurrent}
          error={errors.current} type="password" autoComplete="current-password" />
        <TextField id="password-new" label={t('reset.new_password')}
          hint={t('reset.password_hint', { min: digits(PASSWORD.minSingleFactor, lang), minMfa: digits(PASSWORD.minWithMfa, lang) })}
          value={next} onChange={setNext} error={errors.next} type="password" autoComplete="new-password" />
        <SubmitButton busy={busy}>{t('password.change_submit')}</SubmitButton>
      </form>
    </section>
  );
}

function PhoneChange() {
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
    if (!p) { setError(t('field.phone_invalid')); return; }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await withStepUp(() => api.post('/me/phone/change', { phone: p }, { stepUpAction: 'phone.change' }) as Promise<{ resendAt: string }>);
      if (r !== 'cancelled') { setSentTo(p); setResendUntil(untilServerTime(r.resendAt)); }
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
    if (!isSixDigits(code)) { setError(t('code.six_digits')); return; }
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
      else if (name === 'contact-unavailable') { setSentTo(null); setError(t('contact.unavailable')); }
      else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="phone-title" className={styles.section}>
      <h2 id="phone-title">{t('contact.phone_title')}</h2>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      {sentTo === null
        ? (
          <form onSubmit={start} noValidate>
            <TextField id="phone-new" label={t('contact.new_phone')} hint={t('field.phone_hint')} value={phone} onChange={setPhone}
              error={error ?? undefined} type="tel" inputMode="tel" autoComplete="tel" />
            <SubmitButton busy={busy} disabled={resendIn > 0}>
              {resendIn > 0 ? t('wait.seconds', { seconds: digits(resendIn, lang) }) : t('contact.phone_submit')}
            </SubmitButton>
          </form>
        )
        : (
          <form onSubmit={verify} noValidate>
            <p>{t('register.code_sent', { phone: sentTo })}</p>
            <TextField id="phone-code" label={t('code.label')} value={code} onChange={setCode} error={error ?? undefined}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
            <div className={styles.actions}>
              <SubmitButton busy={busy}>{t('contact.phone_verify')}</SubmitButton>
              <button type="button" disabled={resendIn > 0 || busy} onClick={() => void start()}>
                {resendIn > 0 ? t('code.resend_in', { seconds: digits(resendIn, lang) }) : t('code.resend')}
              </button>
            </div>
          </form>
        )}
    </section>
  );
}

function EmailChange() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!looksLikeEmail(email)) { setError(t('field.email_invalid')); return; }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await withStepUp(() => api.post('/me/email/change', { email: email.trim() }, { stepUpAction: 'email.change' }));
      if (r !== 'cancelled') setMessage({ kind: 'success', text: t('contact.email_sent', { email: email.trim() }) });
    } catch (err) {
      if (problemName(err) === 'contact-unavailable') setError(t('contact.unavailable'));
      else if (problemName(err) === 'validation-failed') setError(t('field.email_invalid'));
      else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="email-title" className={styles.section}>
      <h2 id="email-title">{t('contact.email_title')}</h2>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <form onSubmit={submit} noValidate>
        <TextField id="email-new" label={t('contact.new_email')} value={email} onChange={setEmail} error={error ?? undefined}
          type="email" autoComplete="email" />
        <SubmitButton busy={busy}>{t('contact.email_submit')}</SubmitButton>
      </form>
    </section>
  );
}
