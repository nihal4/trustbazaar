// Changing the password on the security page (SEC-AUTH-11), behind step-up.
import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage, SubmitButton, TextField } from '../../shared/form';
import { problemName } from '../../shared/problems';
import { digits, otherError, passwordReasonText, rejectedPasswordReason, useAccountT } from './common';
import { PASSWORD } from './input';
import { SESSIONS_KEY, withStepUp } from './securityShared';

export function PasswordForm() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string }>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const e: typeof errors = {};
    if (!current) e.current = t('password.current_required');
    if ([...next].length > PASSWORD.max) e.next = passwordReasonText('too-long', t, lang);
    else if ([...next].length < PASSWORD.minWithMfa) e.next = passwordReasonText('too-short', t, lang);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await withStepUp(() => api.post('/auth/password/change', { currentPassword: current, newPassword: next }, { stepUpAction: 'password.change' }));
      if (r !== 'cancelled') {
        setCurrent('');
        setNext('');
        setMessage({ kind: 'success', text: t('password.changed') });
        await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }); // the others are shown as ended
      }
    } catch (err) {
      const reason = rejectedPasswordReason(err);
      if (reason) setErrors({ next: passwordReasonText(reason, t, lang) });
      else if (problemName(err) === 'password-incorrect') setErrors({ current: t('password.current_wrong') });
      else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p>{t('password.change_intro')}</p>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <form onSubmit={submit} noValidate>
        <TextField
          id="password-current"
          label={t('password.current')}
          value={current}
          onChange={setCurrent}
          error={errors.current}
          type="password"
          autoComplete="current-password"
        />
        <TextField
          id="password-new"
          label={t('reset.new_password')}
          hint={t('reset.password_hint', { min: digits(PASSWORD.minSingleFactor, lang), minMfa: digits(PASSWORD.minWithMfa, lang) })}
          value={next}
          onChange={setNext}
          error={errors.next}
          type="password"
          autoComplete="new-password"
        />
        <SubmitButton busy={busy}>{t('password.change_submit')}</SubmitButton>
      </form>
    </>
  );
}
