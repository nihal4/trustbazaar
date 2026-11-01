// Sign in (IF-UI-01; Unit 1 section 6.2): one error text for every failure, so the page never tells
// which accounts exist (SEC-AUTH-05); the growing delay after failures (SEC-AUTH-04) is a countdown on
// the button; with MFA on, a second step asks for the authenticator or recovery code.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { FormMessage, SubmitButton, TextField } from '../../shared/form';
import { isApiError, problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { digits, otherError, retryAfter, useAccountT, useAfterSignIn } from './common';
import { normaliseLogin } from './input';
import styles from './account.module.css';

export function Component() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const afterSignIn = useAfterSignIn();
  const [params] = useSearchParams();
  const next = params.get('next');

  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

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
      const r: { mfaRequired?: boolean } | null = await api.post('/auth/signin', { login: normaliseLogin(login), password });
      if (r?.mfaRequired) {
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
      await api.post('/auth/signin/mfa', { code: toAsciiDigits(code).trim() });
      await afterSignIn(next);
    } catch (err) {
      if (problemName(err) === 'mfa-failed' || isApiError(err, 400) || retryAfter(err) !== null) refused(err, t('signin.mfa_failed'));
      else if (isApiError(err, 401)) {           // the sign-in ticket has ended: start again
        setStep('password');
        setCode('');
        setPassword('');
        setMessage(t('signin.mfa_restart'));
      } else setMessage(otherError(err, t, lang));
      setBusy(false);
    }
  };

  const button = waitFor > 0 ? t('wait.seconds', { seconds: digits(waitFor, lang) }) : null;

  if (step === 'mfa') {
    return (
      <div className={styles.narrow}>
        <h1>{t('signin.mfa_title')}</h1>
        <p>{t('signin.mfa_text')}</p>
        {message && <FormMessage kind="error">{message}</FormMessage>}
        <form onSubmit={submitCode} noValidate>
          <TextField id="signin-code" label={t('code.label')} value={code} onChange={setCode}
            autoComplete="one-time-code" maxLength={40} autoFocus />
          <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('signin.submit')}</SubmitButton>
        </form>
        <p><button type="button" className={styles.link} onClick={() => { setStep('password'); setMessage(null); }}>
          {t('signin.back')}
        </button></p>
      </div>
    );
  }

  return (
    <div className={styles.narrow}>
      <h1>{t('signin.title')}</h1>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <form onSubmit={submitPassword} noValidate>
        <TextField id="signin-login" label={t('signin.login')} hint={t('signin.login_hint')} value={login} onChange={setLogin}
          autoComplete="username" />
        <TextField id="signin-password" label={t('field.password')} value={password} onChange={setPassword}
          type="password" autoComplete="current-password" />
        <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('signin.submit')}</SubmitButton>
      </form>
      <p><Link to="/reset">{t('signin.forgot')}</Link></p>
      <p>{t('signin.no_account')} <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>{t('register.link')}</Link></p>
    </div>
  );
}
