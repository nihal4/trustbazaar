// Sign in (IF-UI-01; Unit 1 section 6.2): one error text for every failure, so the page never tells
// which accounts exist (SEC-AUTH-05); the growing delay after failures (SEC-AUTH-04) is a countdown on
// the button; with MFA on, a second step asks for the authenticator or recovery code.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { CheckboxField, SubmitButton, TextField } from '../../shared/form';
import { isApiError, problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { digits, otherError, retryAfter, useAccountT, useAfterSignIn } from './common';
import { useViewport } from '../../shared/gridCell';
import { loginProblem, normaliseLogin } from './input';
import { AuthSplit } from './AuthSplit';
import styles from './account.module.css';

export function Component() {
  const { t, lang } = useAccountT();
  const { vw } = useViewport();
  const rows = rowsFor(vw);
  const head = headFor(vw);
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
      <AuthSplit stepKey="code" rows={rows} headCells={head}
        head={<><h1>{t(email ? 'signin.email_title' : 'signin.mfa_title')}</h1><p className={styles.lead}>{email ? t('signin.email_text', { email: hint }) : t('signin.mfa_text')}</p></>}
        foot={(
          <div className={styles.footLinks}>
            <button type="button" className={styles.link} onClick={() => { setStep('login'); setMessage(null); }}>{t('signin.back')}</button>
            {email && (
              <button type="button" className={styles.link} disabled={resending || resendIn > 0} onClick={() => void resend()}>
                {resendIn > 0 ? t('signin.resend_wait', { seconds: digits(resendIn, lang) }) : t('signin.resend')}
              </button>
            )}
          </div>
        )}>
        <form onSubmit={submitCode} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField id="signin-code" label={t('code.label')} value={code} onChange={setCode}
              autoComplete="one-time-code" inputMode={email ? 'numeric' : undefined} maxLength={40} autoFocus />
            <Slot message={message} ok={message === t('signin.resent')} />
          </div>
          <div className={styles.extra}><CheckboxField id="signin-remember" label={t('signin.remember')} checked={remember} onChange={setRemember} /></div>
          <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('signin.submit')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  }

  // the first step asks for the number or e-mail only; Enter shows the password. Nothing is asked of the server here, so the page never tells which
  // accounts exist (SEC-AUTH-05); the password step keeps the login in the form (hidden) so a password manager still pairs the two.
  const toPassword = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    // nothing leaves the page unless it is a mobile number or an e-mail of a valid form; an e-mail is then asked about its domain (FR-ACC-13), which reads
    // no account: 'nihal@examle.com' is turned back here, with no sign-in tried
    if (loginProblem(login)) { setMessage(t('signin.login_invalid')); return; }
    const entered = login.trim();
    if (entered.includes('@')) {
      setBusy(true);
      setMessage(null);
      try {
        const r = (await api.post('/auth/login-check', { login: normaliseLogin(entered) })) as { ok: boolean; reason?: string } | null;
        if (r && r.ok === false) {
          setMessage(r.reason === 'domain' ? t('signin.email_domain', { domain: entered.slice(entered.lastIndexOf('@') + 1) }) : t('signin.login_invalid'));
          setBusy(false);
          return;
        }
      } catch (err) {
        if (isApiError(err, 429)) { setMessage(otherError(err, t, lang)); setBusy(false); return; }
        // a check that cannot be answered does not stop the sign-in
      }
      setBusy(false);
    }
    setMessage(null);
    setStep('password');
  };

  // the foot of the first two steps: the way to an account, in the words the page already had
  const toRegister = (
    <p className={styles.footNote}>
      {t('signin.welcome')} {t('signin.no_account')}{' '}
      <Link to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}>{t('register.link')}</Link>
    </p>
  );

  if (step === 'login') {
    return (
      <AuthSplit stepKey="login" rows={rows} headCells={head} head={<h1>{t('signin.title')}</h1>} foot={toRegister}>
        <form onSubmit={toPassword} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField id="signin-login" label={t('signin.login')} value={login} onChange={setLogin}
              autoComplete="username" autoFocus />
            <Slot message={message} />
          </div>
          <SubmitButton busy={busy}>{t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit stepKey="password" rows={rows} headCells={head} foot={toRegister}
      head={(
        <>
          <h1>{t('signin.title')}</h1>
          <p className={styles.lead}>
            <span className={styles.who}>{login.trim()}</span>{' '}
            <button type="button" className={styles.link} onClick={() => { setStep('login'); setPassword(''); setMessage(null); }}>{t('signin.change_login')}</button>
          </p>
        </>
      )}>
      <form onSubmit={submitPassword} noValidate className={styles.stepForm}>
        <input type="text" name="username" autoComplete="username" value={login} readOnly tabIndex={-1} aria-hidden="true" className={styles.srOnly} />
        <div className={styles.fieldGroup}>
          <TextField id="signin-password" label={t('field.password')} value={password} onChange={setPassword}
            type="password" autoComplete="current-password" autoFocus />
          <Slot message={message} />
        </div>
        <div className={styles.extra}><Link to="/reset" className={styles.forgotLink}>{t('signin.forgot')}</Link></div>
        <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('signin.submit')}</SubmitButton>
      </form>
    </AuthSplit>
  );
}

/** One height for the card in every step of sign-in (cells): set from the tallest step, so the card never grows or shrinks and no step has a void; a narrow
 *  screen wraps more lines and needs more. */
const headFor = (vw: number) => (vw < 520 ? 5 : 4);
const rowsFor = (vw: number) => headFor(vw) + 7 + 2;                 // the heading band, the form's seven rows, the foot's two

/** The line under the field where a refusal or a notice is said (U10-25): a place of its own, kept free, so a message does not move anything. */
function Slot({ message, ok = false }: { message: string | null; ok?: boolean }) {
  return (
    <div className={styles.slot} role={message && !ok ? 'alert' : 'status'}>
      {message && <p className={ok ? styles.slotOk : styles.slotError}>{message}</p>}
    </div>
  );
}
