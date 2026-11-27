import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { ME_KEY, useMe } from '../../shared/me';
import { otherError, useAccountT } from './common';
import styles from './account.module.css';
import { Button } from '../../shared/ui';
import { withStepUp } from './securityShared';

/** FR-ACC-12: the code by e-mail at each sign-in, on by default; turning it off is behind step-up, turning it on is not. */
export function EmailCodeSetting() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const me = useMe();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  if (!me.data) return null;
  const on = me.data.emailTwoStep !== false;
  const change = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = on
        ? await withStepUp(() => api.post('/me/security/email-code/disable', {}, { stepUpAction: 'mfa.disable' }))
        : await api.post('/me/security/email-code/enable', {});
      if (r !== 'cancelled') {
        await queryClient.invalidateQueries({ queryKey: ME_KEY });
        setMessage({ kind: 'success', text: t(on ? 'email_code.turned_off' : 'email_code.turned_on') });
      }
    } catch (err) {
      setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="email-code-title" className={styles.section}>
      <h2 id="email-code-title">{t('email_code.title')}</h2>
      <p>{t(on ? 'email_code.on' : 'email_code.off')}</p>
      {on && me.data.mfaEnabled && <p className={styles.hint}>{t('email_code.app_instead')}</p>}
      {on && !me.data.mfaEnabled && !me.data.emailVerified && <p className={styles.hint}>{t('email_code.verify_first')}</p>}
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <p>
        <Button variant="secondary" type="button" disabled={busy} onClick={() => void change()}>
          {t(on ? 'email_code.turn_off' : 'email_code.turn_on')}
        </Button>
      </p>
    </section>
  );
}
