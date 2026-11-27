import { formatWait } from '../../shared/wait';
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toAsciiDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { CodeField, FormMessage, SubmitButton, TextField } from '../../shared/form';
import { fieldErrors, problemName } from '../../shared/problems';
import { StepUpCancelled } from '../../shared/stepUp';
import { digits, otherError, passwordReasonText, rejectedPasswordReason, retryAfter, useAccountT } from './common';
import { isSixDigits, PASSWORD } from './input';
import styles from './account.module.css';
import { wrongCode } from './mfaShared';

export function TurnOff({
  sessionsKey,
  onOff,
  onStateChanged,
}: {
  sessionsKey: readonly unknown[];
  onOff: (passwordChanged: boolean) => Promise<void>;
  onStateChanged: () => void;
}) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ code?: string; password?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!isSixDigits(code)) {
      setErrors({ code: t('mfa.code_six') });
      return;
    }
    setBusy(true);
    setErrors({});
    setMessage(null);
    const newPassword = password ? password : undefined;
    try {
      await api.del('/me/mfa/totp', {
        body: { code: toAsciiDigits(code).trim(), ...(newPassword ? { newPassword } : {}) },
        stepUpAction: 'mfa.disable',
      });
      setCode('');
      setPassword('');
      if (newPassword) await queryClient.invalidateQueries({ queryKey: sessionsKey });
      await onOff(Boolean(newPassword));
    } catch (err) {
      if (err instanceof StepUpCancelled) {
        setBusy(false);
        return;
      }
      const name = problemName(err);
      const wait = retryAfter(err);
      const reason = rejectedPasswordReason(err);
      if (wait !== null) setWaitUntil(untilAfter(wait));
      else if (wrongCode(name)) setErrors({ code: t('mfa.code_wrong_app') });
      else if (name === 'mfa-state') onStateChanged();
      else if (reason === 'required-without-mfa' || fieldErrors(err).some((f) => f.reason === 'required-without-mfa')) {
        setErrors({ password: t('mfa.password_needed', { min: digits(PASSWORD.minSingleFactor, lang) }) });
      } else if (reason) setErrors({ password: passwordReasonText(reason, t, lang) });
      else setMessage(otherError(err, t, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className={styles.subsection}>
      <h3>{t('mfa.off_title')}</h3>
      <p>{t('mfa.off_explain')}</p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <CodeField id="mfa-off-code" label={t('mfa.app_code')} hint={t('mfa.app_code_hint')} value={code} onChange={setCode} error={errors.code} />
      <TextField
        id="mfa-off-password"
        label={t('mfa.new_password')}
        hint={t('mfa.new_password_hint', { min: digits(PASSWORD.minSingleFactor, lang) })}
        value={password}
        onChange={setPassword}
        error={errors.password}
        type="password"
        autoComplete="new-password"
      />
      <SubmitButton busy={busy} disabled={waitFor > 0}>
        {waitFor > 0 ? t('wait.seconds', { time: formatWait(waitFor, lang) }) : t('mfa.turn_off')}
      </SubmitButton>
    </form>
  );
}
