// MFA settings on the security page (FR-ACC-06; Unit 1 section 6.5 and the U1-12 decisions):
// turning the authenticator app on (QR code, the secret as text, the otpauth:// link, the first code),
// the ten recovery codes shown once, new recovery codes, and turning it off. The secret and the codes
// live only in this component's state: never in the query cache or browser storage.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useApi } from '../../shared/api';

import { FormMessage } from '../../shared/form';
import { ME_KEY, useMe } from '../../shared/me';
import { problemName } from '../../shared/problems';
import { Popup } from '../../shared/Popup';
import { StepUpCancelled } from '../../shared/stepUp';
import { otherError, useAccountT } from './common';

import styles from './account.module.css';
import { Button } from '../../shared/ui';
import { Enrol } from './MfaEnrol';

import { RecoveryCodes } from './MfaRecoveryCodes';
import { TurnOff } from './MfaTurnOff';

type View = { kind: 'idle' } | { kind: 'enrolling'; otpauthUri: string; secret: string } | { kind: 'codes'; codes: string[]; fresh: 'enabled' | 'regenerated' };

export function MfaSettings({ sessionsKey }: { sessionsKey: readonly unknown[] }) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const me = useMe();
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

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
  if (me.isError) return null; // the page above already asks to sign in when there is no session
  const on = me.data.mfaEnabled;

  // the recovery codes are shown once: while they are on screen the popup cannot be closed by Escape, the cross or a click outside, only by its own Done (the steps before it close like any popup, and nothing is turned on until the first code is right)
  const locked = view.kind === 'codes';
  const content = (
    <>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}

      {view.kind === 'enrolling' && (
        <Enrol
          otpauthUri={view.otpauthUri}
          secret={view.secret}
          onDone={(codes) => {
            setView({ kind: 'codes', codes, fresh: 'enabled' });
            void refreshMe();
          }}
          onCancel={() => {
            setView({ kind: 'idle' });
            setMessage(null);
          }}
          onStateChanged={() => void stateChanged()}
        />
      )}

      {view.kind === 'codes' && (
        <RecoveryCodes
          codes={view.codes}
          fresh={view.fresh}
          onDone={() => {
            setView({ kind: 'idle' });
            setMessage({ kind: 'success', text: t(view.fresh === 'enabled' ? 'mfa.enabled' : 'mfa.codes_replaced') });
          }}
        />
      )}

      {view.kind === 'idle' && !on && (
        <>
          <p>{t('mfa.off_intro')}</p>
          <Button variant="secondary" type="button" onClick={() => void start()} disabled={busy}>
            {t('mfa.turn_on')}
          </Button>
        </>
      )}

      {view.kind === 'idle' && on && (
        <>
          <p>{t('mfa.on_intro')}</p>
          <h3>{t('mfa.codes_title')}</h3>
          <p>{t('mfa.regenerate_intro')}</p>
          <Button variant="secondary" type="button" onClick={() => void regenerate()} disabled={busy}>
            {t('mfa.regenerate')}
          </Button>
          <TurnOff
            sessionsKey={sessionsKey}
            onOff={async (passwordChanged) => {
              setMessage({ kind: 'success', text: t(passwordChanged ? 'mfa.off_with_password' : 'mfa.off') });
              await refreshMe();
            }}
            onStateChanged={() => void stateChanged()}
          />
        </>
      )}
    </>
  );
  return (
    <li>
      <button type="button" className={styles.settingRow} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span>{t('mfa.title')}</span>
        <span className={styles.settingValue}>{t(on ? 'account.mfa_on' : 'account.mfa_off')}</span>
      </button>
      {open && (
        <Popup
          id="mfa-popup"
          title={t('mfa.title')}
          closeLabel={t('legal.close')}
          wide
          busy={locked || busy}
          onClose={() => {
            setOpen(false);
            setView({ kind: 'idle' });
            setMessage(null);
          }}
        >
          {content}
        </Popup>
      )}
    </li>
  );
}
