// Sign in (IF-UI-01; Unit 1 section 6.2): one error text for every failure, so the page never tells
// which accounts exist (SEC-AUTH-05); the growing delay after failures (SEC-AUTH-04) is a countdown on
// the button; with MFA on, a second step asks for the authenticator or recovery code.
import { formatWait } from '../../shared/wait';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { CheckboxField, CodeField, SubmitButton, TextField } from '../../shared/form';
import { isApiError, problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { otherError, retryAfter, useAccountT, useAfterSignIn } from './common';
import { useViewport } from '../../shared/gridCell';
import { loginProblem, normaliseLogin } from './input';
import { AuthSplit } from './AuthSplit';
import { NoAccount } from './registerParts';
import { authRows, fieldAria, headFor, Slot } from './AuthParts';
import styles from './account.module.css';
import { Button } from '../../shared/ui';

export function Component() {
  const { t, lang } = useAccountT();
  const { vw } = useViewport();
  const rows = authRows(vw, lang === 'bn');
  const head = headFor(vw, lang === 'bn');
  const api = useApi();
  const afterSignIn = useAfterSignIn();
  const [params] = useSearchParams();
  const next = params.get('next');

  // the steps are history entries, so the browser's Back button goes from the code to the password to the number; a step is honoured only if this visit
  // reached it (a reload, or a stale entry, starts again at the number, as the sign-in ticket does not outlive the page)
  type Step = 'login' | 'password' | 'mfa';
  const navigate = useNavigate();
  const location = useLocation();
  const reached = useRef(new Set<Step>(['login']));
  const asked = (location.state as { step?: Step } | null)?.step;
  const step: Step = asked && reached.current.has(asked) ? asked : 'login';
  const setStep = (next: Step) => {
    reached.current.add(next);
    navigate({ pathname: location.pathname, search: location.search }, { state: { step: next } });
  };
  // a member who has just created an account arrives with the e-mail address filled in and a line saying the account is ready (U10-25)
  const arrived = location.state as { login?: string; created?: boolean } | null;
  const [login, setLogin] = useState(arrived?.login ?? '');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(arrived?.created ? t('signin.account_ready') : null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);
  // the second step: an authenticator code, or (the default) a code sent to the e-mail address; 'remember this device' skips it for 30 days
  const [method, setMethod] = useState<'totp' | 'email'>('totp');
  const [hint, setHint] = useState('');
  const [remember, setRemember] = useState(false);
  const [resendUntil, setResendUntil] = useState<number | null>(null);
  const resendIn = useSecondsLeft(resendUntil);
  const [resending, setResending] = useState(false);
  // each step names itself in the tab and to a screen reader (the heading is also the first thing the field is described by)
  useEffect(() => {
    const name = step === 'mfa' ? t(method === 'email' ? 'signin.email_title' : 'signin.mfa_title') : t('signin.title');
    document.title = `${name} – TrustBazaar`;
  }, [step, method, t]);

  const refused = (err: unknown, failedText: string) => {
    const wait = retryAfter(err);
    if (wait !== null) {
      setWaitUntil(untilAfter(wait));
      setMessage(t('signin.too_many'));
      return;
    }
    // every refusal of the credentials reads the same (SEC-AUTH-05)
    if (isApiError(err, 401) || isApiError(err, 400)) {
      setMessage(failedText);
      return;
    }
    setMessage(otherError(err, t, lang));
  };

  const submitPassword = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!login.trim() || !password) {
      setMessage(t('signin.failed'));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const r: { mfaRequired?: boolean; method?: 'email'; emailHint?: string; resendAfter?: number } | null = await api.post('/auth/signin', {
        login: normaliseLogin(login),
        password,
      });
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
      else if (isApiError(err, 401)) {
        // the sign-in ticket has ended: start again
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
      else if (isApiError(err, 401)) {
        setStep('login');
        setCode('');
        setPassword('');
        setMessage(t('signin.mfa_restart'));
      } else setMessage(otherError(err, t, lang));
    }
    setResending(false);
  };

  const button = waitFor > 0 ? t('wait.seconds', { time: formatWait(waitFor, lang) }) : null;

  if (step === 'mfa') {
    const email = method === 'email';
    return (
      <AuthSplit
        stepKey="code"
        rows={rows}
        headCells={head}
        head={
          <>
            <h1 id="signin-head">{t(email ? 'signin.email_title' : 'signin.mfa_title')}</h1>
            <p className={styles.lead}>{email ? t('signin.email_text', { email: hint }) : t('signin.mfa_text')}</p>
          </>
        }
        foot={
          <div className={styles.footLinks}>
            <Button
              variant="link"
              type="button"
              onClick={() => {
                setStep('login');
                setMessage(null);
              }}
            >
              {t('signin.back')}
            </Button>
            {email && (
              <Button variant="link" type="button" aria-disabled={resending || resendIn > 0} onClick={() => void resend()}>
                {resendIn > 0 ? t('signin.resend_wait', { time: formatWait(resendIn, lang) }) : t('signin.resend')}
              </Button>
            )}
          </div>
        }
      >
        <form onSubmit={submitCode} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            {/* the code sent by e-mail is six digits; an authenticator code too, or a recovery code, whose letters turn the cells into a line of text */}
            <CodeField
              id="signin-code"
              label={t('code.label')}
              value={code}
              onChange={setCode}
              autoFocus
              allowRecovery={!email}
              {...fieldAria(message, message === t('signin.resent'), 'signin-message')}
            />
            <Slot id="signin-message" message={message} ok={message === t('signin.resent')} />
          </div>
          <div className={styles.extra}>
            <CheckboxField id="signin-remember" label={t('signin.remember')} checked={remember} onChange={setRemember} />
          </div>
          <SubmitButton busy={busy} disabled={waitFor > 0}>
            {button ?? t('signin.submit')}
          </SubmitButton>
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
    if (loginProblem(login)) {
      setMessage(t('signin.login_invalid'));
      return;
    }
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
        if (isApiError(err, 429)) {
          setMessage(otherError(err, t, lang));
          setBusy(false);
          return;
        }
        // a check that cannot be answered does not stop the sign-in
      }
      setBusy(false);
    }
    setMessage(null);
    setStep('password');
  };

  // the foot of the first two steps: the way to an account, in the words the page already had
  const toRegister = <NoAccount t={t} next={next} />;

  if (step === 'login') {
    return (
      <AuthSplit stepKey="login" rows={rows} headCells={head} head={<h1 id="signin-head">{t('signin.title')}</h1>} foot={toRegister}>
        <form onSubmit={toPassword} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField
              id="signin-login"
              label={t('signin.login')}
              value={login}
              onChange={setLogin}
              autoComplete="username"
              autoFocus
              {...fieldAria(message, message === t('signin.account_ready'), 'signin-message')}
            />
            <Slot id="signin-message" message={message} ok={message === t('signin.account_ready')} />
          </div>
          <SubmitButton busy={busy}>{busy ? t('signin.working') : t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit
      stepKey="password"
      rows={rows}
      headCells={head}
      foot={toRegister}
      head={
        <>
          <h1 id="signin-head">{t('signin.title')}</h1>
          <p className={`${styles.lead} ${styles.leadRow}`}>
            <span className={styles.who}>{login.trim()}</span>{' '}
            <Button
              variant="link"
              type="button"
              onClick={() => {
                setStep('login');
                setPassword('');
                setMessage(null);
              }}
            >
              {t('signin.change_login')}
            </Button>
          </p>
        </>
      }
    >
      <form onSubmit={submitPassword} noValidate className={styles.stepForm}>
        <input type="text" name="username" autoComplete="username" value={login} readOnly tabIndex={-1} aria-hidden="true" className={styles.srOnly} />
        <div className={styles.fieldGroup}>
          <TextField
            id="signin-password"
            label={t('field.password')}
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="current-password"
            autoFocus
            {...fieldAria(message, false, 'signin-message')}
          />
          <Slot id="signin-message" message={message} />
        </div>
        <div className={styles.extra}>
          <Link to="/reset" className={styles.forgotLink}>
            {t('signin.forgot')}
          </Link>
        </div>
        <SubmitButton busy={busy} disabled={waitFor > 0}>
          {button ?? t('signin.submit')}
        </SubmitButton>
      </form>
    </AuthSplit>
  );
}
