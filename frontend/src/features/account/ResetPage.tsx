// Password reset, step one (IF-UI-01; FR-ACC-07): the same answer whether or not the account exists.
// An e-mail address gets a link (to /reset-password); a mobile number gets an SMS code, entered here.
import { useState, type FormEvent } from 'react';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { FormMessage, SubmitButton, TextField } from '../../shared/form';
import { toAsciiDigits } from '../../lib/money.js';
import { digits, otherError, retryAfter, useAccountT } from './common';
import { bangladeshiMobile, isSixDigits, loginKind, normaliseLogin } from './input';
import { NewPasswordForm } from './NewPassword';
import styles from './account.module.css';

export function Component() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const [login, setLogin] = useState('');
  const [sentTo, setSentTo] = useState<{ kind: 'phone' | 'email'; phone: string | null } | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

  const ask = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || !login.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/auth/password/forgot', { login: normaliseLogin(login) });
      const kind = loginKind(login.trim());
      setSentTo({ kind, phone: kind === 'phone' ? bangladeshiMobile(login) : null });
    } catch (err) {
      const wait = retryAfter(err);
      if (wait !== null) setWaitUntil(untilAfter(wait));
      else setMessage(otherError(err, t, lang));
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    const phone = sentTo.phone;
    return (
      <div className={styles.narrow}>
        <h1>{t('reset.title')}</h1>
        <FormMessage kind="info">{t(sentTo.kind === 'email' ? 'reset.sent_email' : 'reset.sent_phone')}</FormMessage>
        {sentTo.kind === 'phone' && phone && (
          <NewPasswordForm
            proof={() => {
              if (!isSixDigits(code)) { setCodeError(t('code.six_digits')); return null; }
              setCodeError(null);
              return { phone, code: toAsciiDigits(code).trim() };
            }}
            onProofRefused={(kind) => setCodeError(t(kind === 'wrong' ? 'code.wrong' : 'reset.code_expired'))}
            codeField={
              <TextField id="reset-code" label={t('code.label')} value={code} onChange={setCode} error={codeError ?? undefined}
                inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
            }
          />
        )}
        <p><button type="button" className={styles.link} onClick={() => { setSentTo(null); setCode(''); }}>{t('reset.again')}</button></p>
      </div>
    );
  }

  return (
    <div className={styles.narrow}>
      <h1>{t('reset.title')}</h1>
      <p>{t('reset.intro')}</p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <form onSubmit={ask} noValidate>
        <TextField id="reset-login" label={t('signin.login')} hint={t('signin.login_hint')} value={login} onChange={setLogin}
          autoComplete="username" />
        <SubmitButton busy={busy} disabled={waitFor > 0}>
          {waitFor > 0 ? t('wait.seconds', { seconds: digits(waitFor, lang) }) : t('reset.send')}
        </SubmitButton>
      </form>
    </div>
  );
}
