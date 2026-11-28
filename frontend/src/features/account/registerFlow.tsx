// The state and the handlers of registration (FR-ACC-01, FR-ACC-04): the steps as history entries, the checks before each call, the resend timer and the
// refusals of Unit 1. RegisterPage draws the steps from what this returns.
import { formatWait } from '../../shared/wait';
import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, untilServerTime, useSecondsLeft } from '../../shared/countdown';
import { useViewport } from '../../shared/gridCell';
import { fieldErrors, isApiError, problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { otherError, passwordReasonText, rejectedPasswordReason, retryAfter, useAccountT } from './common';
import { bangladeshiMobile, isSixDigits, looksLikeEmail, passwordLengthProblem } from './input';
import { LEGAL_VERSIONS } from './legal';
import { acceptText, HaveAccount } from './registerParts';
import { authRows, fieldAria, headFor } from './AuthParts';

export type Step = 'name' | 'email' | 'password' | 'code' | 'phone' | 'terms';

export interface Started {
  registrationId: string;
  resendAt: string;
}

export function useRegisterFlow() {
  const { t, lang } = useAccountT();
  const { vw } = useViewport();
  const head = headFor(vw, lang === 'bn');
  const rows = authRows(vw, lang === 'bn');
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
  useEffect(() => {
    document.title = `${t(step === 'code' ? 'register.code_title' : 'register.title')} – TrustBazaar`;
  }, [step, t]);
  const say = (text: string | null, ok = false) => {
    setMessage(text);
    setNotice(ok);
  };
  const button = waitFor > 0 ? t('wait.seconds', { time: formatWait(waitFor, lang) }) : null;
  const restart = (to: Step, text: string | null) => {
    setStarted(null);
    setCode('');
    setAdult(false);
    setAccept(false);
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
  const toEmail = (ev: FormEvent) => {
    ev.preventDefault();
    const n = name.trim();
    if (n.length < 2 || n.length > 40) {
      say(t('register.name_invalid'));
      return;
    }
    say(null);
    setStep('email');
  };
  const toPassword = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const entered = email.trim();
    if (!looksLikeEmail(entered)) {
      say(t('field.email_invalid'));
      return;
    }
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
      if (isApiError(err, 429)) {
        say(otherError(err, t, lang));
        setBusy(false);
        return;
      }
      // a check that cannot be answered does not stop the sign-up
    }
    setBusy(false);
    setStep('password');
  };
  const begin = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const problem = passwordLengthProblem(password);
    if (problem) {
      say(passwordReasonText(problem, t, lang));
      return;
    }
    if (password !== confirm) {
      say(t('register.password_mismatch'));
      return;
    }
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
  const verify = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || !started) return;
    if (!isSixDigits(code)) {
      say(t('register.code_digits'));
      return;
    }
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
  const toTerms = (ev: FormEvent) => {
    ev.preventDefault();
    if (!bangladeshiMobile(phone)) {
      say(t('field.phone_invalid'));
      return;
    }
    say(null);
    setStep('terms');
  };
  const finish = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || !started) return;
    if (!adult) {
      say(t('register.adult_required'));
      return;
    }
    if (!accept) {
      say(t('register.accept_required'));
      return;
    }
    const number = bangladeshiMobile(phone);
    if (!number) {
      say(t('field.phone_invalid'));
      setStep('phone');
      return;
    }
    setBusy(true);
    say(null);
    try {
      await api.post('/auth/register/complete', {
        registrationId: started.registrationId,
        phone: number,
        password,
        adultConfirmed: adult,
        termsVersion: LEGAL_VERSIONS.terms,
        privacyVersion: LEGAL_VERSIONS.privacy,
      });
      navigate(
        { pathname: '/signin', search: next ? `?next=${encodeURIComponent(next)}` : '' },
        { replace: true, state: { login: email.trim().toLowerCase(), created: true } },
      );
      return;
    } catch (err) {
      const fields = fieldErrors(err);
      const reason = rejectedPasswordReason(err);
      const pn = problemName(err);
      if (reason) restart('password', passwordReasonText(reason, t, lang));
      else if (pn === 'registration-refused') restart('name', t('register.refused'));
      else if (pn === 'otp-expired' || pn === 'not-found') restart('name', t('register.start_again'));
      else if (fields.some((f) => (f.field === 'termsVersion' || f.field === 'privacyVersion') && f.reason === 'not-current')) say(t('register.terms_changed'));
      else if (fields.some((f) => f.field === 'phone')) {
        say(t('field.phone_invalid'));
        setStep('phone');
      } else if (fields.some((f) => f.field === 'adultConfirmed')) say(t('register.adult_required'));
      else if (!tooMany(err)) say(otherError(err, t, lang));
    }
    setBusy(false);
  };
  const signIn = <HaveAccount t={t} next={next} />;
  const heading = <h1 id="register-head">{t('register.title')}</h1>;
  const aria = (ok = false) => fieldAria(message, ok, 'register-message', 'register-head');
  const open = (kind: 'terms' | 'privacy') => (ev: MouseEvent<HTMLButtonElement>) => {
    ev.preventDefault();
    setDialog({ kind, opener: ev.currentTarget });
  };
  const backTo = (to: Step) => () => {
    say(null);
    setStep(to);
  };
  const acceptLabel = acceptText(t, open);
  return {
    t,
    lang,
    head,
    rows,
    step,
    name,
    setName,
    email,
    setEmail,
    password,
    setPassword,
    confirm,
    setConfirm,
    phone,
    setPhone,
    code,
    setCode,
    adult,
    setAdult,
    accept,
    setAccept,
    message,
    notice,
    busy,
    waitFor,
    resendIn,
    resending,
    dialog,
    setDialog,
    button,
    toEmail,
    toPassword,
    begin,
    verify,
    resend,
    toTerms,
    finish,
    signIn,
    heading,
    aria,
    backTo,
    acceptLabel,
  };
}
