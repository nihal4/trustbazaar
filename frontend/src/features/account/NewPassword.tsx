// Choosing a new password after a reset link or code (SEC-AUTH-10; Unit 1 section 6.4), in the form band of the ruled card (U10-25). With MFA on, Unit 1
// answers mfa-required and nothing is spent, so the form then also asks for the second factor. A reset by SMS asks for the code here too.
import { formatWait } from '../../shared/wait';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { SubmitButton, TextField } from '../../shared/form';
import { problemName } from '../../shared/problems';
import { toAsciiDigits } from '../../lib/money.js';
import { digits, otherError, passwordReasonText, rejectedPasswordReason, retryAfter, useAccountT } from './common';
import { fieldAria, Slot } from './AuthParts';
import { AuthSplit } from './AuthSplit';
import { isSixDigits, passwordLengthProblem, PASSWORD } from './input';
import styles from './account.module.css';

/** What proves the reset: the link's token, or the number the SMS code was sent to (the code is typed in the form). */
export type ResetProof = { token: string } | { phone: string };
type Target = 'code' | 'password' | 'mfa';

export function NewPasswordForm({ proof, onDone, onLinkRefused }: {
  proof: ResetProof;
  onDone: () => void;
  /** the link's token was refused or has expired */
  onLinkRefused?: () => void;
}) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const phone = 'phone' in proof ? proof.phone : null;
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [askMfa, setAskMfa] = useState(false);
  const [message, setMessage] = useState<{ text: string; target: Target | null; ok?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);
  const aria = (f: Target) => fieldAria(message?.target === f ? message.text : null, Boolean(message?.ok), 'reset-message', 'reset-head');
  const say = (text: string, target: Target | null, ok = false) => setMessage({ text, target, ok });

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (phone && !isSixDigits(code)) { say(t('code.six_digits'), 'code'); return; }
    // only the upper bound is certain here: an MFA user may use 8 characters (Unit 1 decides)
    const problem = passwordLengthProblem(password, true);
    if (problem) { say(passwordReasonText(problem, t, lang), 'password'); return; }
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/auth/password/reset', {
        ...(phone ? { phone, code: toAsciiDigits(code).trim() } : proof), newPassword: password,
        ...(askMfa && mfaCode.trim() ? { mfaCode: toAsciiDigits(mfaCode).trim() } : {}),
      });
      onDone();
      return;
    } catch (err) {
      const name = problemName(err);
      const reason = rejectedPasswordReason(err);
      const wait = retryAfter(err);
      if (reason) say(passwordReasonText(reason, t, lang), 'password');
      else if (wait !== null) { setWaitUntil(untilAfter(wait)); say(t('signin.too_many'), null); }
      else if (name === 'mfa-required') { setAskMfa(true); say(t('reset.mfa_needed'), askMfa ? 'mfa' : null, !askMfa); }
      else if (name === 'mfa-failed') say(t('code.wrong'), 'mfa');
      else if (name === 'otp-failed' && phone) say(t('code.wrong'), 'code');
      else if ((name === 'otp-expired' || name === 'link-invalid') && phone) say(t('reset.code_expired'), 'code');
      else if (name === 'otp-failed' || name === 'otp-expired' || name === 'link-invalid') onLinkRefused?.();
      else say(otherError(err, t, lang), null);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className={styles.stepForm}>
      <div className={styles.fieldGroup}>
        {phone && <TextField id="reset-code" label={t('code.label')} value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} autoFocus {...aria('code')} />}
        <TextField id="reset-password" label={t('reset.new_password')}
          hint={t('reset.password_hint', { min: digits(PASSWORD.minSingleFactor, lang), minMfa: digits(PASSWORD.minWithMfa, lang) })}
          value={password} onChange={setPassword} type="password" autoComplete="new-password" autoFocus={!phone} {...aria('password')} />
        {askMfa && <TextField id="reset-mfa" label={t('reset.mfa_code')} value={mfaCode} onChange={setMfaCode} autoComplete="one-time-code" maxLength={40} autoFocus {...aria('mfa')} />}
        <Slot id="reset-message" message={message?.text ?? null} ok={Boolean(message?.ok)} />
      </div>
      <SubmitButton busy={busy} disabled={waitFor > 0}>
        {waitFor > 0 ? t('wait.seconds', { time: formatWait(waitFor, lang) }) : t('reset.save')}
      </SubmitButton>
    </form>
  );
}

/** The last step of a reset: said, with the one button to sign-in. The card has the height of the steps before it. */
export function ResetDone({ rows, head }: { rows: number; head: number }) {
  const { t } = useAccountT();
  const navigate = useNavigate();
  return (
    <AuthSplit stepKey="done" rows={rows} headCells={head} head={<h1 id="reset-head">{t('reset.title')}</h1>}
      foot={<p className={styles.footNote}>{t('signin.no_account')} <Link to="/register">{t('register.link')}</Link></p>}>
      <form onSubmit={(e) => { e.preventDefault(); navigate('/signin', { replace: true }); }} noValidate className={styles.stepForm}>
        <p role="status" className={styles.stepText}>{t('reset.done')}</p>
        <SubmitButton busy={false}>{t('signin.submit')}</SubmitButton>
      </form>
    </AuthSplit>
  );
}
