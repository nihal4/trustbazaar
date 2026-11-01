// MFA settings on the security page (FR-ACC-06; Unit 1 section 6.5 and the U1-12 decisions):
// turning the authenticator app on (QR code, the secret as text, the otpauth:// link, the first code),
// the ten recovery codes shown once, new recovery codes, and turning it off. The secret and the codes
// live only in this component's state: never in the query cache or browser storage.
import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toAsciiDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { untilAfter, useSecondsLeft } from '../../shared/countdown';
import { CheckboxField, FormMessage, SubmitButton, TextField } from '../../shared/form';
import { ME_KEY, useMe } from '../../shared/me';
import { fieldErrors, problemName } from '../../shared/problems';
import { StepUpCancelled } from '../../shared/stepUp';
import { digits, otherError, passwordReasonText, rejectedPasswordReason, retryAfter, useAccountT } from './common';
import { isSixDigits, PASSWORD } from './input';
import styles from './account.module.css';

const QrCode = lazy(() => import('./QrCode'));

/**
 * A refused code: `otp-failed` (400) since Unit 1's fix #142; `mfa-failed` is the older name, kept so
 * the message is right either way (Decisions log, U8-12).
 */
const wrongCode = (name: string | null) => name === 'otp-failed' || name === 'mfa-failed';

/** The secret as people read it: groups of four. */
export const groupSecret = (secret: string) => secret.replace(/\s+/g, '').match(/.{1,4}/g)?.join(' ') ?? '';

type View =
  | { kind: 'idle' }
  | { kind: 'enrolling'; otpauthUri: string; secret: string }
  | { kind: 'codes'; codes: string[]; fresh: 'enabled' | 'regenerated' };

export function MfaSettings({ sessionsKey }: { sessionsKey: readonly unknown[] }) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const me = useMe();
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshMe = () => queryClient.invalidateQueries({ queryKey: ME_KEY });
  /** `mfa-state`: already on, already off, or not started; the page shows the current state again. */
  const stateChanged = async () => {
    setView({ kind: 'idle' });
    setMessage({ kind: 'info', text: t('mfa.state_changed') });
    await refreshMe();
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r: { otpauthUri: string; secret: string } = await api.post('/me/mfa/totp', {});
      setView({ kind: 'enrolling', ...r });
    } catch (err) {
      if (problemName(err) === 'mfa-state') await stateChanged();
      else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r: { recoveryCodes: string[] } = await api.post('/me/mfa/recovery-codes', {}, { stepUpAction: 'recovery.regenerate' });
      setView({ kind: 'codes', codes: r.recoveryCodes, fresh: 'regenerated' });
    } catch (err) {
      if (err instanceof StepUpCancelled) return;
      if (problemName(err) === 'mfa-state') await stateChanged();
      else setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(false);
    }
  };

  if (me.isPending) return null;
  if (me.isError) return null;   // the page above already asks to sign in when there is no session
  const on = me.data.mfaEnabled;

  return (
    <section aria-labelledby="mfa-title" className={styles.section}>
      <h2 id="mfa-title">{t('mfa.title')}</h2>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}

      {view.kind === 'enrolling' && (
        <Enrol otpauthUri={view.otpauthUri} secret={view.secret}
          onDone={(codes) => { setView({ kind: 'codes', codes, fresh: 'enabled' }); void refreshMe(); }}
          onCancel={() => { setView({ kind: 'idle' }); setMessage(null); }}
          onStateChanged={() => void stateChanged()} />
      )}

      {view.kind === 'codes' && (
        <RecoveryCodes codes={view.codes} fresh={view.fresh}
          onDone={() => { setView({ kind: 'idle' }); setMessage({ kind: 'success', text: t(view.fresh === 'enabled' ? 'mfa.enabled' : 'mfa.codes_replaced') }); }} />
      )}

      {view.kind === 'idle' && !on && (
        <>
          <p>{t('mfa.off_intro')}</p>
          <button type="button" className={styles.secondary} onClick={() => void start()} disabled={busy}>{t('mfa.turn_on')}</button>
        </>
      )}

      {view.kind === 'idle' && on && (
        <>
          <p>{t('mfa.on_intro')}</p>
          <h3>{t('mfa.codes_title')}</h3>
          <p>{t('mfa.regenerate_intro')}</p>
          <button type="button" className={styles.secondary} onClick={() => void regenerate()} disabled={busy}>{t('mfa.regenerate')}</button>
          <TurnOff sessionsKey={sessionsKey} onOff={async (passwordChanged) => {
            setMessage({ kind: 'success', text: t(passwordChanged ? 'mfa.off_with_password' : 'mfa.off') });
            await refreshMe();
          }} onStateChanged={() => void stateChanged()} />
        </>
      )}
    </section>
  );
}

function Enrol({ otpauthUri, secret, onDone, onCancel, onStateChanged }: {
  otpauthUri: string; secret: string; onDone: (codes: string[]) => void; onCancel: () => void; onStateChanged: () => void;
}) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const waitFor = useSecondsLeft(waitUntil);

  const confirm = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    if (!isSixDigits(code)) { setError(t('mfa.code_six')); return; }
    setBusy(true);
    setError(null);
    try {
      const r: { recoveryCodes: string[] } = await api.post('/me/mfa/totp/confirm', { code: toAsciiDigits(code).trim() });
      onDone(r.recoveryCodes);
    } catch (err) {
      const wait = retryAfter(err);
      const name = problemName(err);
      if (wait !== null) setWaitUntil(untilAfter(wait));
      else if (wrongCode(name)) setError(t('mfa.code_wrong'));
      else if (name === 'mfa-state') onStateChanged();
      else setError(otherError(err, t, lang));
      setBusy(false);
    }
  };

  return (
    <div>
      <ol className={styles.steps}>
        <li>{t('mfa.step_app')}</li>
        <li>{t('mfa.step_scan')}</li>
      </ol>
      <Suspense fallback={<p role="status">{t('shell.loading')}</p>}>
        <QrCode text={otpauthUri} label={t('mfa.qr_label')} />
      </Suspense>
      <p>{t('mfa.manual')}</p>
      <p className={styles.secret} aria-label={t('mfa.secret_label')}>{groupSecret(secret)}</p>
      <div className={styles.actions}>
        <CopyButton text={secret.replace(/\s+/g, '')} label={t('mfa.copy_secret')} />
        <a href={otpauthUri}>{t('mfa.open_app')}</a>
      </div>
      <form onSubmit={confirm} noValidate>
        <TextField id="mfa-confirm-code" label={t('mfa.first_code')} hint={t('mfa.first_code_hint')} value={code} onChange={setCode}
          error={error ?? undefined} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
        <div className={styles.actions}>
          <SubmitButton busy={busy} disabled={waitFor > 0}>
            {waitFor > 0 ? t('wait.seconds', { seconds: digits(waitFor, lang) }) : t('mfa.confirm')}
          </SubmitButton>
          <button type="button" onClick={onCancel} disabled={busy}>{t('mfa.cancel')}</button>
        </div>
      </form>
    </div>
  );
}

/** The recovery codes, shown once: copy, save as a text file, and a confirmation before leaving. */
function RecoveryCodes({ codes, fresh, onDone }: { codes: string[]; fresh: 'enabled' | 'regenerated'; onDone: () => void }) {
  const { t } = useAccountT();
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');

  const download = () => {
    const blob = new Blob([`${t('mfa.file_heading')}\n\n${text}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trustbazaar-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <FormMessage kind="info">{t(fresh === 'enabled' ? 'mfa.codes_intro' : 'mfa.codes_new_intro')}</FormMessage>
      <ol className={styles.codes} aria-label={t('mfa.codes_title')}>
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ol>
      <div className={styles.actions}>
        <CopyButton text={text} label={t('mfa.copy_codes')} />
        <button type="button" onClick={download}>{t('mfa.download_codes')}</button>
      </div>
      <CheckboxField id="mfa-codes-saved" label={t('mfa.codes_saved')} checked={saved} onChange={setSaved} />
      <button type="button" className={styles.secondary} onClick={onDone} disabled={!saved}>{t('mfa.done')}</button>
    </div>
  );
}

function TurnOff({ sessionsKey, onOff, onStateChanged }: {
  sessionsKey: readonly unknown[]; onOff: (passwordChanged: boolean) => Promise<void>; onStateChanged: () => void;
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
    if (!isSixDigits(code)) { setErrors({ code: t('mfa.code_six') }); return; }
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
      if (err instanceof StepUpCancelled) { setBusy(false); return; }
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
      <TextField id="mfa-off-code" label={t('mfa.app_code')} hint={t('mfa.app_code_hint')} value={code} onChange={setCode}
        error={errors.code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
      <TextField id="mfa-off-password" label={t('mfa.new_password')}
        hint={t('mfa.new_password_hint', { min: digits(PASSWORD.minSingleFactor, lang) })} value={password} onChange={setPassword}
        error={errors.password} type="password" autoComplete="new-password" />
      <SubmitButton busy={busy} disabled={waitFor > 0}>
        {waitFor > 0 ? t('wait.seconds', { seconds: digits(waitFor, lang) }) : t('mfa.turn_off')}
      </SubmitButton>
    </form>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useAccountT();
  const [done, setDone] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      setDone(false);
    }
  };
  return (
    <>
      <button type="button" onClick={() => void copy()}>{label}</button>
      {done !== null && <span role="status">{t(done ? 'mfa.copied' : 'mfa.copy_failed')}</span>}
    </>
  );
}
