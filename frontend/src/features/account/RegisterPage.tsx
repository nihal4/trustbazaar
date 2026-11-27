// Register (IF-UI-01; Unit 1 section 6.1; U10-25): the same fresh page and ruled card as sign-in, one question at a time: the full name, the e-mail address,
// the password twice, the code sent to the e-mail address, the mobile number, then the terms and conditions (read in a dialog) and the age confirmation.
// The account exists only after the last step (FR-ACC-01, FR-ACC-04); the person is not signed in by it and goes to the sign-in page, and an e-mail says the
// account was created. The steps are history entries, as in sign-in; a reload starts again at the name.
import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, untilServerTime, useSecondsLeft } from '../../shared/countdown';
import { CheckboxField, SubmitButton, TextField } from '../../shared/form';
import { useViewport } from '../../shared/gridCell';
import { fieldErrors, isApiError, problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { digits, otherError, passwordReasonText, rejectedPasswordReason, retryAfter, useAccountT } from './common';
import { bangladeshiMobile, isSixDigits, looksLikeEmail, passwordLengthProblem, PASSWORD } from './input';
import { LEGAL_VERSIONS } from './legal';
import { fieldAria, Slot } from './AuthParts';
import { AuthSplit } from './AuthSplit';
import { LegalDialog } from './LegalDocs';
import styles from './account.module.css';

type Step = 'name' | 'email' | 'password' | 'code' | 'phone' | 'terms';
interface Started { registrationId: string; resendAt: string }

/** One height for the card in every step (cells), set from the tallest step (the password and its confirmation, or the terms and the age), so the card never
 *  grows or shrinks between steps; a narrow screen wraps more lines and needs more. The heading band is as in sign-in. */
const headFor = (vw: number, bangla: boolean) => (vw < 360 ? (bangla ? 8 : 7) : vw < 520 ? (bangla ? 7 : 6) : 5);
/** The form band: the password step with a message under it is the tallest; a narrow screen wraps the message and the labels and needs more room. */
const bodyFor = (vw: number) => (vw < 360 ? 14 : vw < 520 ? 13 : 11);
const rowsFor = (vw: number, bangla: boolean) => headFor(vw, bangla) + bodyFor(vw) + 2;

export function Component() {
  const { t, lang } = useAccountT();
  const { vw } = useViewport();
  const head = headFor(vw, lang === 'bn');
  const rows = rowsFor(vw, lang === 'bn');
  const api = useApi();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = params.get('next');

  const reached = useRef(new Set<Step>(['name']));
  const asked = (location.state as { step?: Step } | null)?.step;
  const step: Step = asked && reached.current.has(asked) ? asked : 'name';
  const setStep = (to: Step) => {
    reached.current.add(to);
    navigate({ pathname: location.pathname, search: location.search }, { state: { step: to } });
  };

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [adult, setAdult] = useState(false);
  const [accept, setAccept] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);
  const [started, setStarted] = useState<Started | null>(null);
  const [resendUntil, setResendUntil] = useState<number | null>(null);
  const resendIn = useSecondsLeft(resendUntil);
  const [resending, setResending] = useState(false);
  const [dialog, setDialog] = useState<{ kind: 'terms' | 'privacy'; opener: HTMLElement | null } | null>(null);

  useEffect(() => { document.title = `${t(step === 'code' ? 'register.code_title' : 'register.title')} – TrustBazaar`; }, [step, t]);

  const say = (text: string | null, ok = false) => { setMessage(text); setNotice(ok); };
  const button = waitFor > 0 ? t('wait.seconds', { seconds: digits(waitFor, lang) }) : null;
  const restart = (to: Step, text: string | null) => {
    setStarted(null); setCode(''); setAdult(false); setAccept(false);
    reached.current = new Set(['name', 'email', 'password']);
    say(text);
    setStep(to);
  };
  const tooMany = (err: unknown) => {
    const wait = retryAfter(err);
    if (wait === null) return false;
    setWaitUntil(untilAfter(wait));
    say(t('signin.too_many'));
    return true;
  };

  // 1. the name
  const toEmail = (ev: FormEvent) => {
    ev.preventDefault();
    const n = name.trim();
    if (n.length < 2 || n.length > 40) { say(t('register.name_invalid')); return; }
    say(null);
    setStep('email');
  };

  // 2. the e-mail address: of a valid form, then of a domain that can receive mail (FR-ACC-13; it reads no account, so nothing is told about who has one)
  const toPassword = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const entered = email.trim();
    if (!looksLikeEmail(entered)) { say(t('field.email_invalid')); return; }
    setBusy(true);
    say(null);
    try {
      const r = (await api.post('/auth/login-check', { login: entered.toLowerCase() })) as { ok: boolean; reason?: string } | null;
      if (r && r.ok === false) {
        say(r.reason === 'domain' ? t('signin.email_domain', { domain: entered.slice(entered.lastIndexOf('@') + 1) }) : t('field.email_invalid'));
        setBusy(false);
        return;
      }
    } catch (err) {
      if (isApiError(err, 429)) { say(otherError(err, t, lang)); setBusy(false); return; }
      // a check that cannot be answered does not stop the sign-up
    }
    setBusy(false);
    setStep('password');
  };

  // 3. the password, twice; the e-mail address gets its code
  const begin = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const problem = passwordLengthProblem(password);
    if (problem) { say(passwordReasonText(problem, t, lang)); return; }
    if (password !== confirm) { say(t('register.password_mismatch')); return; }
    setBusy(true);
    say(null);
    try {
      const s: Started = await api.post('/auth/register', { email: email.trim(), displayName: name.trim(), password });
      setStarted(s);
      setResendUntil(untilServerTime(s.resendAt));
      setCode('');
      setStep('code');
    } catch (err) {
      const reason = rejectedPasswordReason(err);
      if (reason) say(passwordReasonText(reason, t, lang));
      else if (!tooMany(err)) say(otherError(err, t, lang));
    }
    setBusy(false);
  };

  // 4. the code from the e-mail
  const verify = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || !started) return;
    if (!isSixDigits(code)) { say(t('register.code_digits')); return; }
    setBusy(true);
    say(null);
    try {
      await api.post('/auth/register/verify', { registrationId: started.registrationId, code: toAsciiDigits(code).trim() });
      reached.current.delete('code'); // the code is used up: Back from the next step does not return to it
      setStep('phone');
    } catch (err) {
      const name = problemName(err);
      if (name === 'otp-failed') say(t('code.wrong'));
      else if (name === 'otp-expired') say(t('code.expired'));
      else if (!tooMany(err)) say(otherError(err, t, lang));
    }
    setBusy(false);
  };

  const resend = async () => {
    if (!started || resending || resendIn > 0) return;
    setResending(true);
    say(null);
    try {
      const s: Started = await api.post('/auth/register/resend', { registrationId: started.registrationId });
      setStarted({ ...started, ...s });
      setResendUntil(untilServerTime(s.resendAt));
      setCode('');
      say(t('signin.resent'), true);
    } catch (err) {
      const wait = retryAfter(err);
      if (wait !== null) setResendUntil(untilAfter(wait));
      else if (isApiError(err, 404) || problemName(err) === 'not-found') restart('name', t('register.start_again'));
      else say(otherError(err, t, lang));
    }
    setResending(false);
  };

  // 5. the mobile number (its code is not asked at sign-up)
  const toTerms = (ev: FormEvent) => {
    ev.preventDefault();
    if (!bangladeshiMobile(phone)) { say(t('field.phone_invalid')); return; }
    say(null);
    setStep('terms');
  };

  // 6. the age and the terms: the account is made
  const finish = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || !started) return;
    if (!adult) { say(t('register.adult_required')); return; }
    if (!accept) { say(t('register.accept_required')); return; }
    const number = bangladeshiMobile(phone);
    if (!number) { say(t('field.phone_invalid')); setStep('phone'); return; }
    setBusy(true);
    say(null);
    try {
      await api.post('/auth/register/complete', {
        registrationId: started.registrationId, phone: number, password, adultConfirmed: adult,
        termsVersion: LEGAL_VERSIONS.terms, privacyVersion: LEGAL_VERSIONS.privacy,
      });
      navigate({ pathname: '/signin', search: next ? `?next=${encodeURIComponent(next)}` : '' }, { replace: true, state: { login: email.trim().toLowerCase(), created: true } });
      return;
    } catch (err) {
      const fields = fieldErrors(err);
      const reason = rejectedPasswordReason(err);
      const pn = problemName(err);
      if (reason) restart('password', passwordReasonText(reason, t, lang));
      else if (pn === 'registration-refused') restart('name', t('register.refused'));
      else if (pn === 'otp-expired' || pn === 'not-found') restart('name', t('register.start_again'));
      else if (fields.some((f) => (f.field === 'termsVersion' || f.field === 'privacyVersion') && f.reason === 'not-current')) say(t('register.terms_changed'));
      else if (fields.some((f) => f.field === 'phone')) { say(t('field.phone_invalid')); setStep('phone'); }
      else if (fields.some((f) => f.field === 'adultConfirmed')) say(t('register.adult_required'));
      else if (!tooMany(err)) say(otherError(err, t, lang));
    }
    setBusy(false);
  };

  const signIn = (
    <p className={styles.footNote}>
      {t('register.have_account')}{' '}
      <Link to={next ? `/signin?next=${encodeURIComponent(next)}` : '/signin'}>{t('signin.link')}</Link>
    </p>
  );
  const heading = <h1 id="register-head">{t('register.title')}</h1>;
  const aria = (ok = false) => fieldAria(message, ok, 'register-message', 'register-head');
  const open = (kind: 'terms' | 'privacy') => (ev: MouseEvent<HTMLButtonElement>) => { ev.preventDefault(); setDialog({ kind, opener: ev.currentTarget }); };
  const backTo = (to: Step) => () => { say(null); setStep(to); };

  // the words of the box with two links in them, in the order each language puts them
  const acceptLabel: ReactNode = t('register.accept_text', { terms: '{terms}', privacy: '{privacy}' })
    .split(/(\{terms\}|\{privacy\})/)
    .map((part, i) => {
      if (part === '{terms}') return <button key={i} type="button" className={`${styles.link} ${styles.textLink}`} onClick={open('terms')}>{t('legal.terms_name')}</button>;
      if (part === '{privacy}') return <button key={i} type="button" className={`${styles.link} ${styles.textLink}`} onClick={open('privacy')}>{t('legal.privacy_name')}</button>;
      return part;
    });

  let card: ReactNode;
  if (step === 'name') {
    card = (
      <AuthSplit stepKey="name" rows={rows} headCells={head} head={heading} foot={signIn}>
        <form onSubmit={toEmail} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField id="register-name" label={t('register.name')} hint={t('register.name_hint')} value={name} onChange={setName}
              autoComplete="name" maxLength={40} autoFocus {...aria()} />
            <Slot id="register-message" message={message} ok={notice} />
          </div>
          <SubmitButton busy={false}>{t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  } else if (step === 'email') {
    card = (
      <AuthSplit stepKey="email" rows={rows} headCells={head} head={heading} foot={signIn}>
        <form onSubmit={(e) => void toPassword(e)} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField id="register-email" label={t('field.email')} value={email} onChange={setEmail} type="email" autoComplete="email" autoFocus {...aria()} />
            <Slot id="register-message" message={message} ok={notice} />
          </div>
          <SubmitButton busy={busy}>{busy ? t('signin.working') : t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  } else if (step === 'password') {
    card = (
      <AuthSplit stepKey="password" rows={rows} headCells={head} head={heading} foot={signIn}>
        <form onSubmit={(e) => void begin(e)} noValidate className={styles.stepForm}>
          <input type="text" name="username" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" className={styles.srOnly} />
          <div className={styles.fieldGroup}>
            <TextField id="register-password" label={t('field.password')} hint={t('register.password_hint', { min: digits(PASSWORD.minSingleFactor, lang) })}
              value={password} onChange={setPassword} type="password" autoComplete="new-password" autoFocus {...aria(message === t('register.password_mismatch'))} />
            <TextField id="register-confirm" label={t('register.confirm')} value={confirm} onChange={setConfirm}
              type="password" autoComplete="new-password" {...aria(message !== t('register.password_mismatch'))} />
            <Slot id="register-message" message={message} ok={notice} />
          </div>
          <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  } else if (step === 'code') {
    card = (
      <AuthSplit stepKey="code" rows={rows} headCells={head}
        head={<><h1 id="register-head">{t('register.code_title')}</h1><p className={styles.lead}>{t('register.code_sent_email', { email: email.trim() })}</p></>}
        foot={(
          <div className={styles.footLinks}>
            <button type="button" className={styles.link} onClick={backTo('password')}>{t('register.change_details')}</button>
            <button type="button" className={styles.link} aria-disabled={resending || resendIn > 0} onClick={() => void resend()}>
              {resendIn > 0 ? t('signin.resend_wait', { seconds: digits(resendIn, lang) }) : t('signin.resend')}
            </button>
          </div>
        )}>
        <form onSubmit={(e) => void verify(e)} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField id="register-code" label={t('code.label')} value={code} onChange={setCode} autoComplete="one-time-code" inputMode="numeric"
              maxLength={6} autoFocus {...aria(notice)} />
            <Slot id="register-message" message={message} ok={notice} />
          </div>
          <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('register.verify')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  } else if (step === 'phone') {
    card = (
      <AuthSplit stepKey="phone" rows={rows} headCells={head} head={heading} foot={signIn}>
        <form onSubmit={toTerms} noValidate className={styles.stepForm}>
          <div className={styles.fieldGroup}>
            <TextField id="register-phone" label={t('field.phone')} hint={t('field.phone_hint')} value={phone} onChange={setPhone}
              type="tel" inputMode="tel" autoComplete="tel" autoFocus {...aria()} />
            <Slot id="register-message" message={message} ok={notice} />
          </div>
          <SubmitButton busy={false}>{t('signin.continue')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  } else {
    card = (
      <AuthSplit stepKey="terms" rows={rows} headCells={head} head={heading}
        foot={<div className={styles.footLinks}><button type="button" className={styles.link} onClick={backTo('phone')}>{t('signin.back')}</button></div>}>
        <form onSubmit={(e) => void finish(e)} noValidate className={styles.stepForm}>
          <div className={styles.checks}>
            <div className={styles.extra}><CheckboxField id="register-adult" label={t('register.adult')} checked={adult} onChange={setAdult} autoFocus /></div>
            <div className={styles.extra}><CheckboxField id="register-accept" label={acceptLabel} checked={accept} onChange={setAccept} /></div>
            <Slot id="register-message" message={message} ok={notice} />
          </div>
          <SubmitButton busy={busy} disabled={waitFor > 0}>{button ?? t('register.submit')}</SubmitButton>
        </form>
      </AuthSplit>
    );
  }

  return (
    <>
      {card}
      {dialog && <LegalDialog kind={dialog.kind} opener={dialog.opener} onClose={() => setDialog(null)} />}
    </>
  );
}
