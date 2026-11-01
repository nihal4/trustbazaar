// Register (IF-UI-01; Unit 1 section 6.1): details, the privacy notice and the age confirmation before
// submit (FR-ACC-04, FR-PRV-01); then the SMS code, with a new code offered only when Unit 1 allows.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, untilServerTime, useSecondsLeft } from '../../shared/countdown';
import { CheckboxField, ErrorSummary, FormMessage, SubmitButton, TextField, type SummaryItem } from '../../shared/form';
import { fieldErrors, problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { digits, otherError, passwordReasonText, rejectedPasswordReason, retryAfter, useAccountT, useAfterSignIn } from './common';
import { bangladeshiMobile, isSixDigits, looksLikeEmail, passwordLengthProblem, PASSWORD } from './input';
import { LEGAL_VERSIONS } from './legal';
import { PrivacyNotice } from './PrivacyNotice';
import styles from './account.module.css';

interface Started { registrationId: string; resendAt: string }
type Field = 'displayName' | 'phone' | 'email' | 'password' | 'adult' | 'accept';

export function Component() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const afterSignIn = useAfterSignIn();
  const [params] = useSearchParams();
  const next = params.get('next');

  const [form, setForm] = useState({ displayName: '', phone: '', email: '', password: '' });
  const [adult, setAdult] = useState(false);
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

  const [started, setStarted] = useState<(Started & { phone: string }) | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resendUntil, setResendUntil] = useState<number | null>(null);
  const resendIn = useSecondsLeft(resendUntil);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const check = (): Partial<Record<Field, string>> => {
    const e: Partial<Record<Field, string>> = {};
    const name = form.displayName.trim();
    if (name.length < 2 || name.length > 40) e.displayName = t('register.name_invalid');
    if (!bangladeshiMobile(form.phone)) e.phone = t('field.phone_invalid');
    if (!looksLikeEmail(form.email)) e.email = t('field.email_invalid');
    const pw = passwordLengthProblem(form.password);
    if (pw) e.password = passwordReasonText(pw, t, lang);
    if (!adult) e.adult = t('register.adult_required');
    if (!accept) e.accept = t('register.accept_required');
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setMessage(null);
    const e = check();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    const phone = bangladeshiMobile(form.phone)!;
    try {
      const s: Started = await api.post('/auth/register', {
        phone, email: form.email.trim(), displayName: form.displayName.trim(), password: form.password,
        termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy, adultConfirmed: adult,
      });
      setStarted({ ...s, phone });
      setResendUntil(untilServerTime(s.resendAt));
    } catch (err) {
      const reason = rejectedPasswordReason(err);
      const wait = retryAfter(err);
      if (reason) setErrors({ password: passwordReasonText(reason, t, lang) });
      else if (wait !== null) setWaitUntil(untilAfter(wait));
      else if (problemName(err) === 'validation-failed') {
        const fe: Partial<Record<Field, string>> = {};
        let formMessage: string | null = null;
        for (const f of fieldErrors(err)) {
          if (f.field === 'phone') fe.phone = t('field.phone_invalid');
          else if (f.field === 'email') fe.email = t('field.email_invalid');
          else if (f.field === 'displayName') fe.displayName = t('register.name_invalid');
          else if (f.field === 'password') fe.password = t('password.rejected');
          else if (f.field === 'adultConfirmed') fe.adult = t('register.adult_required');
          else if (f.field === 'termsVersion' || f.field === 'privacyVersion') formMessage = t('register.terms_changed');
        }
        setErrors(fe);
        setMessage(formMessage ?? (Object.keys(fe).length === 0 ? otherError(err, t, lang) : null));
      } else setMessage(otherError(err, t, lang));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || !started) return;
    if (!isSixDigits(code)) { setCodeError(t('code.six_digits')); return; }
    setBusy(true);
    setCodeError(null);
    try {
      await api.post('/auth/register/verify', { registrationId: started.registrationId, code: toAsciiDigits(code).trim() });
      await afterSignIn(next);
    } catch (err) {
      const name = problemName(err);
      const wait = retryAfter(err);
      if (wait !== null) setWaitUntil(untilAfter(wait));
      else if (name === 'otp-failed') setCodeError(t('code.wrong'));
      else if (name === 'otp-expired') setCodeError(t('code.expired'));
      else if (name === 'registration-refused') setMessage(t('register.refused'));
      else setMessage(otherError(err, t, lang));
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!started || resendIn > 0) return;
    setCodeError(null);
    try {
      const s: Started = await api.post('/auth/register/resend', { registrationId: started.registrationId });
      setStarted({ ...started, ...s });
      setResendUntil(untilServerTime(s.resendAt));
      setMessage(null);
    } catch (err) {
      const wait = retryAfter(err);
      if (wait !== null) setResendUntil(untilAfter(wait));
      else if (problemName(err) === 'otp-expired') setMessage(t('register.start_again'));
      else setMessage(otherError(err, t, lang));
    }
  };

  const waitText = waitFor > 0 ? t('wait.seconds', { seconds: digits(waitFor, lang) }) : null;

  if (started) {
    return (
      <div className={styles.narrow}>
        <h1>{t('register.code_title')}</h1>
        <p>{t('register.code_sent', { phone: started.phone })}</p>
        {message && <FormMessage kind="error">{message}</FormMessage>}
        <form onSubmit={verify} noValidate>
          <TextField id="code" label={t('code.label')} value={code} onChange={setCode} error={codeError ?? undefined}
            inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
          <div className={styles.actions}>
            <SubmitButton busy={busy} disabled={waitFor > 0}>{waitText ?? t('register.verify')}</SubmitButton>
            <button type="button" onClick={() => void resend()} disabled={resendIn > 0}>
              {resendIn > 0 ? t('code.resend_in', { seconds: digits(resendIn, lang) }) : t('code.resend')}
            </button>
          </div>
        </form>
        <p><button type="button" className={styles.link} onClick={() => { setStarted(null); setCode(''); setMessage(null); }}>
          {t('register.change_details')}
        </button></p>
      </div>
    );
  }

  const summary: SummaryItem[] = (Object.entries(errors) as [Field, string][]).map(([f, m]) => ({ id: `register-${f}`, message: m }));
  return (
    <div className={styles.narrow}>
      <h1>{t('register.title')}</h1>
      <PrivacyNotice />
      <ErrorSummary title={t('form.errors_title')} items={summary} />
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <form onSubmit={submit} noValidate>
        <TextField id="register-displayName" label={t('register.name')} hint={t('register.name_hint')} value={form.displayName}
          onChange={set('displayName')} error={errors.displayName} autoComplete="nickname" maxLength={40} />
        <TextField id="register-phone" label={t('field.phone')} hint={t('field.phone_hint')} value={form.phone}
          onChange={set('phone')} error={errors.phone} type="tel" inputMode="tel" autoComplete="tel" />
        <TextField id="register-email" label={t('field.email')} value={form.email} onChange={set('email')}
          error={errors.email} type="email" autoComplete="email" />
        <TextField id="register-password" label={t('field.password')}
          hint={t('register.password_hint', { min: digits(PASSWORD.minSingleFactor, lang) })} value={form.password}
          onChange={set('password')} error={errors.password} type="password" autoComplete="new-password" />
        <CheckboxField id="register-adult" label={t('register.adult')} checked={adult} onChange={setAdult} error={errors.adult} />
        <CheckboxField id="register-accept" label={t('register.accept')} checked={accept} onChange={setAccept} error={errors.accept} />
        <SubmitButton busy={busy} disabled={waitFor > 0}>{waitText ?? t('register.submit')}</SubmitButton>
      </form>
      <p>{t('register.have_account')} <Link to={next ? `/signin?next=${encodeURIComponent(next)}` : '/signin'}>{t('signin.link')}</Link></p>
    </div>
  );
}
