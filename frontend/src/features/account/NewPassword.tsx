// Choosing a new password after a reset link or code (SEC-AUTH-10; Unit 1 section 6.4). With MFA on,
// Unit 1 answers mfa-required and nothing is spent, so the form then also asks for the second factor.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { FormMessage, SubmitButton, TextField } from '../../shared/form';
import { problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { digits, otherError, passwordReasonText, rejectedPasswordReason, retryAfter, useAccountT } from './common';
import { passwordLengthProblem, PASSWORD } from './input';
import styles from './account.module.css';

/** The proof of the reset: the link's token, or the number and the SMS code. */
export type ResetProof = { token: string } | { phone: string; code: string };

export function NewPasswordForm({ proof, codeField, onProofRefused }: {
  proof: () => ResetProof | null;
  /** the SMS code field, when the proof is a code */
  codeField?: React.ReactNode;
  onProofRefused: (kind: 'wrong' | 'expired') => void;
}) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [askMfa, setAskMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const p = proof();
    if (!p) return;
    // only the upper bound is certain here: an MFA user may use 8 characters (Unit 1 decides)
    if (passwordLengthProblem(password, true)) { setError(passwordReasonText(passwordLengthProblem(password, true)!, t, lang)); return; }
    setBusy(true);
    setError(null);
    setMfaError(null);
    setMessage(null);
    try {
      await api.post('/auth/password/reset', {
        ...p, newPassword: password, ...(askMfa && mfaCode.trim() ? { mfaCode: toAsciiDigits(mfaCode).trim() } : {}),
      });
      setDone(true);
    } catch (err) {
      const name = problemName(err);
      const reason = rejectedPasswordReason(err);
      const wait = retryAfter(err);
      if (reason) setError(passwordReasonText(reason, t, lang));
      else if (wait !== null) setWaitUntil(untilAfter(wait));
      else if (name === 'mfa-required') { setAskMfa(true); setMfaError(askMfa ? t('reset.mfa_needed') : null); setMessage(t('reset.mfa_needed')); }
      else if (name === 'mfa-failed') setMfaError(t('code.wrong'));
      else if (name === 'otp-failed') onProofRefused('wrong');
      else if (name === 'otp-expired' || name === 'link-invalid') onProofRefused('expired');
      else setMessage(otherError(err, t, lang));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <FormMessage kind="success">
        <p>{t('reset.done')}</p>
        <p><Link to="/signin">{t('signin.link')}</Link></p>
      </FormMessage>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      {message && <FormMessage kind={askMfa ? 'info' : 'error'}>{message}</FormMessage>}
      {codeField}
      <TextField id="reset-password" label={t('reset.new_password')}
        hint={t('reset.password_hint', { min: digits(PASSWORD.minSingleFactor, lang), minMfa: digits(PASSWORD.minWithMfa, lang) })}
        value={password} onChange={setPassword} error={error ?? undefined} type="password" autoComplete="new-password" />
      {askMfa && (
        <TextField id="reset-mfa" label={t('reset.mfa_code')} value={mfaCode} onChange={setMfaCode}
          error={mfaError ?? undefined} autoComplete="one-time-code" maxLength={40} autoFocus />
      )}
      <div className={styles.actions}>
        <SubmitButton busy={busy} disabled={waitFor > 0}>
          {waitFor > 0 ? t('wait.seconds', { seconds: digits(waitFor, lang) }) : t('reset.save')}
        </SubmitButton>
      </div>
    </form>
  );
}
