// The console's sign-in, /staff/signin (Unit 1 sections 6.7 and 6.8; SEC-AUTH-05, SEC-AUTH-07; I-51; U8-10): the
// e-mail and password, then the authenticator code; every refusal of the credentials reads the same. A new or reset
// staff account first chooses its own password and adds the console to an authenticator app (the key as text in
// fours and the otpauth link), and its first code signs it in. Staff sessions have their own cookies, so a member's
// own session in the user app is untouched.
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toAsciiDigits, toLocalDigits } from '../lib/money.js';
import { useApi } from '../shared/api';
import { errorText } from '../shared/errors';
import { CodeField, FormMessage, SubmitButton, TextField } from '../shared/form';
import { STAFF_ME_KEY } from '../shared/me';
import { fieldErrors, isApiError, problemName } from '../shared/problems';
import { useSignedOut } from '../shared/session';
import { useStaffT } from './text';
import styles from './staff.module.css';

type Step = 'password' | 'mfa' | 'enrol' | 'confirm';
const PASSWORD_REASONS = new Set(['too-short', 'too-long', 'common', 'context', 'unchanged']);

/** Only the console's own pages are a place to return to. */
export const safeNext = (next: string | null) => (next && /^\/(staff|admin)(\/|$)/.test(next) && !next.startsWith('/staff/signin') ? next : '/staff');

export function Component() {
  const { t, lang } = useStaffT();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [, dismiss] = useSignedOut();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [secret, setSecret] = useState<{ otpauthUri: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const done = async () => {
    dismiss();
    queryClient.removeQueries({ queryKey: STAFF_ME_KEY });
    await navigate(safeNext(params.get('next')), { replace: true });
  };
  const run = async (ev: FormEvent, work: () => Promise<void>, refused: (e: unknown) => string) => {
    ev.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage(isApiError(e, 429) ? t('staff.signin.too_many') : problemName(e) === 'session-ended' ? t('staff.signin.ticket_ended') : refused(e));
      if (problemName(e) === 'session-ended') { setStep('password'); setCode(''); }
    }
    setBusy(false);
  };
  const failed = (e: unknown) => (isApiError(e, 401) || isApiError(e, 400) || isApiError(e, 422) ? t('staff.signin.failed') : errorText(e, t, lang));
  const wrongCode = (e: unknown) => (isApiError(e, 401) || isApiError(e, 400) || isApiError(e, 422) ? t('staff.signin.code_failed') : errorText(e, t, lang));

  const submitPassword = (ev: FormEvent) => run(ev, async () => {
    if (!email.trim() || !password) throw Object.assign(new Error('empty'), { status: 401 });
    const r = (await api.post('/staff/auth/signin', { email: email.trim(), password })) as { mfaRequired?: boolean; enrolmentRequired?: boolean };
    setPassword('');
    setStep(r.enrolmentRequired ? 'enrol' : 'mfa');
  }, (e) => (e instanceof Error && e.message === 'empty' ? t('staff.signin.failed') : failed(e)));

  const submitCode = (ev: FormEvent) => run(ev, async () => {
    await api.post(step === 'confirm' ? '/staff/auth/mfa/enrol/confirm' : '/staff/auth/mfa', { code: toAsciiDigits(code).replace(/\s/g, '') });
    await done();
  }, wrongCode);

  const submitNewPassword = (ev: FormEvent) => run(ev, async () => {
    const r = (await api.post('/staff/auth/mfa/enrol', { newPassword })) as { otpauthUri: string; secret: string };
    setNewPassword('');
    setSecret(r);
    setStep('confirm');
  }, (e) => {
    const reason = fieldErrors(e).find((f) => PASSWORD_REASONS.has(f.reason))?.reason;
    return reason ? t(`staff.password.${reason}`, { min: toLocal(8, lang), max: toLocal(256, lang) }) : errorText(e, t, lang);
  });

  return (
    <div className={styles.narrow}>
      <h1>{t('staff.signin.title')}</h1>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {step === 'password' && (
        <form onSubmit={submitPassword} noValidate>
          <TextField id="email" label={t('staff.signin.email')} type="email" autoComplete="username" value={email} onChange={setEmail} />
          <TextField id="password" label={t('staff.signin.password')} type="password" autoComplete="current-password" value={password} onChange={setPassword} />
          <SubmitButton busy={busy}>{t('staff.signin.continue')}</SubmitButton>
        </form>
      )}
      {step === 'enrol' && (
        <form onSubmit={submitNewPassword} noValidate>
          <p>{t('staff.enrol.explain')}</p>
          <TextField id="new-password" label={t('staff.enrol.new_password')} type="password" autoComplete="new-password" value={newPassword} onChange={setNewPassword}
            hint={t('staff.enrol.password_hint', { min: toLocal(8, lang) })} />
          <SubmitButton busy={busy}>{t('staff.enrol.continue')}</SubmitButton>
        </form>
      )}
      {(step === 'mfa' || step === 'confirm') && (
        <form onSubmit={submitCode} noValidate>
          {step === 'confirm' && secret && (
            <>
              <p>{t('staff.enrol.add_app')}</p>
              <p>{t('staff.enrol.key')} <strong className={styles.code}>{secret.secret.match(/.{1,4}/g)?.join(' ')}</strong></p>
              <p><a href={secret.otpauthUri}>{t('staff.enrol.link')}</a></p>
            </>
          )}
          <CodeField id="code" label={t('staff.signin.code')} value={code} onChange={setCode} allowRecovery
            hint={t(step === 'confirm' ? 'staff.enrol.code_hint' : 'staff.signin.code_hint')} />
          <SubmitButton busy={busy}>{t('staff.signin.sign_in')}</SubmitButton>
        </form>
      )}
    </div>
  );
}

const toLocal = (n: number, lang: 'en' | 'bn') => toLocalDigits(String(n), lang);
