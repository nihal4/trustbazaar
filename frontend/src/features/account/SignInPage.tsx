// Sign in (IF-UI-01; Unit 1 section 6.2): one error text for every failure, so the page never tells
// which accounts exist (SEC-AUTH-05); the growing delay after failures (SEC-AUTH-04) is a countdown on
// the button; with MFA on, a second step asks for the authenticator or recovery code.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { CheckboxField, FormMessage, SubmitButton, TextField } from '../../shared/form';
import { isApiError, problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { digits, otherError, retryAfter, useAccountT, useAfterSignIn } from './common';
import { normaliseLogin } from './input';
import { AuthSplit, HumanCheckNote } from './AuthSplit';
import styles from './account.module.css';

export function Component() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const afterSignIn = useAfterSignIn();
  const [params] = useSearchParams();
  const next = params.get('next');

  const [step, setStep] = useState<'login' | 'password' | 'mfa'>('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);
  // the second step: an authenticator code, or (the default) a code sent to the e-mail address; 'remember this device' skips it for 30 days
  const [method, setMethod] = useState<'totp' | 'email'>('totp');
  const [hint, setHint] = useState('');
  const [remember, setRemember] = useState(false);
  const [resendUntil, setResendUntil] = useState<number | null>(null);
  const resendIn = useSecondsLeft(resendUntil);
  const [resending, setResending] = useState(false);

  const refused = (err: unknown, failedText: string) => {
    const wait = retryAfter(err);
    if (wait !== null) { setWaitUntil(untilAfter(wait)); setMessage(t('signin.too_many')); return; }
    // every refusal of the credentials reads the same (SEC-AUTH-05)
    if (isApiError(err, 401) || isApiError(err, 400)) { setMessage(failedText); return; }
    setMessage(otherError(err, t, lang));
  };

  const submitPassword = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!login.trim() || !password) { setMessage(t('signin.failed')); return; }
    setBusy(true);
    setMessage(null);
    try {
      const r: { mfaRequired?: boolean; method?: 'email'; emailHint?: string; resendAfter?: number } | null = await api.post('/auth/signin', { login: normaliseLogin(login), password });
      if (r?.mfaRequired) {
        setMethod(r.method === 'email' ? 'email' : 'totp');
        setHint(r.emailHint ?? '');
        setResendUntil(r.method === 'email' ? untilAfter(r.resendAfter ?? 60) : null);
        setCode('');
        setStep('mfa');
        setBusy(false);
        return;
      }
      await afterSignIn(next);
    } catch (err) {
      refused(err, t('signin.failed'));
      setBusy(false);
    }
  };

  const submitCode = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/auth/signin/mfa', { code: toAsciiDigits(code).trim(), remember });
      await afterSignIn(next);
    } catch (err) {
      if (problemName(err) === 'mfa-failed' || isApiError(err, 400) || retryAfter(err) !== null) refused(err, t('signin.mfa_failed'));
      else if (isApiError(err, 401)) {           // the sign-in ticket has ended: start again
        setStep('login');
        setCode('');
        setPassword('');
        setMessage(t('signin.mfa_restart'));
      } else setMessage(otherError(err, t, lang));
      setBusy(false);
    }
  };

  const resend = async () => {
    if (resending || resendIn > 0) return;
    setResending(true);
    setMessage(null);
    try {
      const r = (await api.post('/auth/signin/mfa/resend', {})) as { resendAfter?: number } | null;
      setResendUntil(untilAfter(r?.resendAfter ?? 60));
      setCode('');
      setMessage(t('signin.resent'));
    } catch (err) {
      const wait = retryAfter(err);
      if (wait !== null) setResendUntil(untilAfter(wait));
      else if (isApiError(err, 401)) { setStep('login'); setCode(''); setPassword(''); setMessage(t('signin.mfa_restart')); }
      else setMessage(otherError(err, t, lang));
    }
    setResending(false);
  };

  const button = waitFor > 0 ? t('wait.seconds', { seconds: digits(waitFor, lang) }) : null;

  if (step === 'mfa') {
    const email = method === 'email';
    return (
      <AuthSplit stepKey="code">
        <h1>{t(email ? 'signin.email_title' : 'signin.mfa_title')}</h1>
        <p className={styles.lead}>{email ? t('signin.email_text', { email: hint }) : t('signin.mfa_text')}</p>
        {message && <FormMessage kind={message === t('signin.resent') ? 'success' : 'error'}>{message}</FormMessage>}
        <form onSubmit={submitCode} noValidate>
          <TextField id="signin-code" label={t('code.label')} value={code} onChange={setCode}
            autoComplete="one-time-code" inputMode={email ? 'numeric' : undefined} maxLength={40} autoFocus />
          <CheckboxField id="signin-remember" label={t('signin.remember')} checked={remember} onChange={setRemember} />
          <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('signin.submit')}</SubmitButton>
        </form>
        {email && (
          <p>
            <button type="button" className={styles.link} disabled={resending || resendIn > 0} onClick={() => void resend()}>
              {resendIn > 0 ? t('signin.resend_wait', { seconds: digits(resendIn, lang) }) : t('signin.resend')}
            </button>
          </p>
        )}
        <p><button type="button" className={styles.link} onClick={() => { setStep('login'); setMessage(null); }}>
          {t('signin.back')}
        </button></p>
      </AuthSplit>
    );
  }

  // the first step asks for the number or e-mail only; Enter shows the password. Nothing is asked of the server here, so the page never tells which
  // accounts exist (SEC-AUTH-05); the password step keeps the login in the form (hidden) so a password manager still pairs the two.
  const toPassword = (ev: FormEvent) => {
    ev.preventDefault();
    if (!login.trim()) { setMessage(t('signin.login_missing')); return; }
    setMessage(null);
    setStep('password');
  };

  if (step === 'login') {
    return (
      <AuthSplit stepKey="login">
        <h1>{t('signin.title')}</h1>
        <p className={styles.lead}>
          {t('signin.welcome')} {t('signin.no_account')}{' '}
          <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>{t('register.link')}</Link>
        </p>
        {message && <FormMessage kind="error">{message}</FormMessage>}
        <form onSubmit={toPassword} noValidate>
          <TextField id="signin-login" label={t('signin.login')} value={login} onChange={setLogin}
            autoComplete="username" autoFocus />
          <SubmitButton busy={false}>{t('signin.continue')}</SubmitButton>
        </form>
        <HumanCheckNote />
      </AuthSplit>
    );
  }

  return (
    <AuthSplit stepKey="password">
      <h1>{t('signin.title')}</h1>
      <p className={styles.lead}>
        <span className={styles.who}>{login.trim()}</span>{' '}
        <button type="button" className={styles.link} onClick={() => { setStep('login'); setPassword(''); setMessage(null); }}>{t('signin.change_login')}</button>
      </p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <form onSubmit={submitPassword} noValidate>
        <input type="text" name="username" autoComplete="username" value={login} readOnly tabIndex={-1} aria-hidden="true" className={styles.srOnly} />
        <TextField id="signin-password" label={t('field.password')} value={password} onChange={setPassword}
          type="password" autoComplete="current-password" autoFocus />
        <p className={styles.forgot}><Link to="/reset">{t('signin.forgot')}</Link></p>
        <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('signin.submit')}</SubmitButton>
      </form>
      <HumanCheckNote />
    </AuthSplit>
  );
}
