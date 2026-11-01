// The account page (IF-UI-01): who is signed in, the identity check, and sign-out. It reads GET /me
// (U1-13).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { useMe, type KycStatus } from '../../shared/me';
import { isApiError } from '../../shared/problems';
import { otherError, useAccountT } from './common';
import styles from './account.module.css';

const KYC_ACTION: Record<KycStatus, boolean> = {
  unsubmitted: true, rejected: true, revoked: false, pending_review: false, verified: false,
};

export function Component() {
  const { t, lang } = useAccountT();
  const me = useMe();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.request('POST', '/auth/signout');
    } catch (err) {
      if (!isApiError(err, 401)) { setMessage(otherError(err, t, lang)); setBusy(false); return; }
    }
    queryClient.clear();   // nothing of this account stays on the device (section 4.3)
    navigate('/', { replace: true });
  };

  if (me.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (me.isError) return <SignInPrompt next="/account" />;

  const u = me.data;
  return (
    <div className={styles.narrow}>
      <h1>{t('account.title')}</h1>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <dl className={styles.facts}>
        <div><dt>{t('account.name')}</dt><dd>{u.displayName}</dd></div>
        {u.phoneMasked && <div><dt>{t('field.phone')}</dt><dd>{u.phoneMasked}</dd></div>}
        {u.email && (
          <div>
            <dt>{t('field.email')}</dt>
            <dd>{u.email} ({t(u.emailVerified ? 'account.email_verified' : 'account.email_unverified')})</dd>
          </div>
        )}
        <div>
          <dt>{t('account.kyc')}</dt>
          <dd>
            {t(`kyc.status.${u.kycStatus}`)}
            {KYC_ACTION[u.kycStatus] && <> <a href="/account/kyc">{t('account.kyc_start')}</a></>}
          </dd>
        </div>
        <div><dt>{t('account.mfa')}</dt><dd>{t(u.mfaEnabled ? 'account.mfa_on' : 'account.mfa_off')}</dd></div>
      </dl>
      {u.accountStatus === 'suspended' && <FormMessage kind="info">{t('account.suspended')}</FormMessage>}
      <p><Link to="/account/security">{t('security.link')}</Link></p>
      <button type="button" className={styles.secondary} onClick={() => void signOut()} disabled={busy}>
        {t('account.sign_out')}
      </button>
    </div>
  );
}

export function SignInPrompt({ next }: { next: string }) {
  const { t } = useAccountT();
  return (
    <div className={styles.narrow}>
      <h1>{t('account.signed_out_title')}</h1>
      <p>{t('account.signed_out_text')}</p>
      <p><Link to={`/signin?next=${encodeURIComponent(next)}`}>{t('signin.link')}</Link></p>
    </div>
  );
}
