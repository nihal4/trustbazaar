// Changing the e-mail address on the security page: asks the member to confirm the new address, behind step-up (FR-ACC-09).
import { useState, type FormEvent } from 'react';
import { useApi } from '../../shared/api';
import { FormMessage, SubmitButton, TextField } from '../../shared/form';
import { problemName } from '../../shared/problems';
import { otherError, useAccountT } from './common';
import { looksLikeEmail } from './input';
import { withStepUp } from './securityShared';

export function EmailForm() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!looksLikeEmail(email)) {
      setError(t('field.email_invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const r = await withStepUp(() => api.post('/me/email/change', { email: email.trim() }, { stepUpAction: 'email.change' }));
      if (r !== 'cancelled') setMessage({ kind: 'success', text: t('contact.email_sent', { email: email.trim() }) });
    } catch (err) {
      if (problemName(err) === 'contact-unavailable') setError(t('contact.unavailable'));
      else if (problemName(err) === 'validation-failed') setError(t('field.email_invalid'));
      else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <form onSubmit={submit} noValidate>
        <TextField
          id="email-new"
          label={t('contact.new_email')}
          value={email}
          onChange={setEmail}
          error={error ?? undefined}
          type="email"
          autoComplete="email"
        />
        <SubmitButton busy={busy}>{t('contact.email_submit')}</SubmitButton>
      </form>
    </>
  );
}
