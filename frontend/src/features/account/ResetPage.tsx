// Password reset, step one (IF-UI-01; FR-ACC-07), on the ruled card (U10-25): the same answer whether or not the account exists. An e-mail address gets a
// link (to /reset-password); a mobile number gets an SMS code, entered here with the new password.
import { formatWait } from '../../shared/wait';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { SubmitButton, TextField } from '../../shared/form';
import { useViewport } from '../../shared/gridCell';
import { otherError, retryAfter, useAccountT } from './common';
import { authRows, fieldAria, headFor, Slot, StepNote } from './AuthParts';
import { AuthSplit } from './AuthSplit';
import { bangladeshiMobile, loginKind, normaliseLogin } from './input';
import { NewPasswordForm, ResetDone } from './NewPassword';
import styles from './account.module.css';
import { Button } from '../../shared/ui';

export function Component() {
  const { t, lang } = useAccountT();
  const { vw } = useViewport();
  const head = headFor(vw, lang === 'bn');
  const rows = authRows(vw, lang === 'bn');
  const api = useApi();
  const [login, setLogin] = useState('');
  const [sentTo, setSentTo] = useState<{ kind: 'phone' | 'email'; phone: string | null } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

  const ask = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!login.trim()) {
      setMessage(t('signin.login_invalid'));
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/auth/password/forgot', { login: normaliseLogin(login) });
      const kind = loginKind(login.trim());
      setSentTo({ kind, phone: kind === 'phone' ? bangladeshiMobile(login) : null });
    } catch (err) {
      const wait = retryAfter(err);
      if (wait !== null) {
        setWaitUntil(untilAfter(wait));
        setMessage(t('signin.too_many'));
      } else setMessage(otherError(err, t, lang));
    }
    setBusy(false);
  };

  const heading = <h1 id="reset-head">{t('reset.title')}</h1>;
  if (done) return <ResetDone rows={rows} head={head} />;

  if (sentTo) {
    const again = (
      <div className={styles.footLinks}>
        <Button
          variant="link"
          type="button"
          onClick={() => {
            setSentTo(null);
            setMessage(null);
          }}
        >
          {t('reset.again')}
        </Button>
      </div>
    );
    return sentTo.kind === 'phone' && sentTo.phone ? (
      <AuthSplit
        stepKey="code"
        rows={rows}
        headCells={head}
        foot={again}
        head={
          <>
            {heading}
            <p className={styles.lead}>{t('reset.sent_phone')}</p>
          </>
        }
      >
        <NewPasswordForm proof={{ phone: sentTo.phone }} onDone={() => setDone(true)} />
      </AuthSplit>
    ) : (
      <AuthSplit stepKey="sent" rows={rows} headCells={head} head={heading} foot={again}>
        <StepNote>
          <p role="status">{t('reset.sent_email')}</p>
        </StepNote>
      </AuthSplit>
    );
  }

  return (
    <AuthSplit
      stepKey="ask"
      rows={rows}
      headCells={head}
      head={
        <>
          {heading}
          <p className={styles.lead}>{t('reset.intro')}</p>
        </>
      }
      foot={
        <div className={styles.footLinks}>
          <Link to="/signin" className={styles.link}>
            {t('signin.back')}
          </Link>
        </div>
      }
    >
      <form onSubmit={(e) => void ask(e)} noValidate className={styles.stepForm}>
        <div className={styles.fieldGroup}>
          <TextField
            id="reset-login"
            label={t('signin.login')}
            value={login}
            onChange={setLogin}
            autoComplete="username"
            autoFocus
            {...fieldAria(message, false, 'reset-message', 'reset-head')}
          />
          <Slot id="reset-message" message={message} />
        </div>
        <SubmitButton busy={busy} disabled={waitFor > 0}>
          {waitFor > 0 ? t('wait.seconds', { time: formatWait(waitFor, lang) }) : t('reset.send')}
        </SubmitButton>
      </form>
    </AuthSplit>
  );
}
