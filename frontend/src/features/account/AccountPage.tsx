// The account page (IF-UI-01): the member's profile on the ruled line grid (U10-25), without boxes: who they are, how they stand with others (rating, completed
// deals, member since), their personal details, what is verified, and sign-out. It reads GET /me (U1-13) and the public summary GET /users/{id}/trust (FR-REV-04).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AccountTabs } from '../../shared/AccountTabs';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { useMe, type KycStatus } from '../../shared/me';
import { isApiError } from '../../shared/problems';
import { toLocalDigits } from '../../lib/money.js';
import { Tick } from '../../shared/icons';
import { otherError, useAccountT } from './common';
import styles from './account.module.css';

const KYC_ACTION: Record<KycStatus, boolean> = {
  unsubmitted: true,
  rejected: true,
  revoked: false,
  pending_review: false,
  verified: false,
};

interface TrustSummary {
  averageRating: number | null;
  ratingCount: number;
  completedTransactions: number;
}

/** The first letter of the name, for the photo place: there is no photo upload yet, so the member's initial stands in it. */
const initialOf = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();

export function Component() {
  const { t, lang } = useAccountT();
  const me = useMe();
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const id = me.data?.id;
  const trust = useQuery({
    queryKey: ['trust', id],
    queryFn: ({ signal }) => api.get(`/users/${id}/trust`, { signal }) as Promise<TrustSummary>,
    enabled: Boolean(id),
    staleTime: 60_000,
    retry: false,
  });

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.request('POST', '/auth/signout');
    } catch (err) {
      if (!isApiError(err, 401)) {
        setMessage(otherError(err, t, lang));
        setBusy(false);
        return;
      }
    }
    queryClient.clear(); // nothing of this account stays on the device (section 4.3)
    navigate('/', { replace: true });
  };

  if (me.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (me.isError) return <SignInPrompt next="/account" />;

  const u = me.data;
  const n = (v: number | string) => toLocalDigits(String(v), lang);
  const since = u.memberSince
    ? new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date(u.memberSince))
    : null;
  const rating = trust.data?.ratingCount
    ? t('account.rating_value', { average: n((trust.data.averageRating ?? 0).toFixed(1)), count: n(trust.data.ratingCount) })
    : t('account.no_ratings');
  return (
    <div className={styles.profile}>
      <AccountTabs t={t} />
      <h1>{t('account.title')}</h1>
      {message && <FormMessage kind="error">{message}</FormMessage>}

      {/* who: the photo place (the initial), the name, and what is verified, as marks */}
      <section className={styles.idBand} aria-label={u.displayName}>
        <div className={styles.avatar} aria-hidden="true">
          <span>{initialOf(u.displayName)}</span>
        </div>
        <div className={styles.idText}>
          <h2 className={styles.nameLine}>
            <span>{u.displayName}</span>
            {u.kycStatus === 'verified' && (
              <span className={styles.tick} title={t('kyc.status.verified')}>
                <Tick />
                <span className={styles.srOnly}>{t('kyc.status.verified')}</span>
              </span>
            )}
          </h2>
          <ul className={styles.marks}>
            <Mark on={u.kycStatus === 'verified'} text={`${t('account.kyc')}: ${t(`kyc.status.${u.kycStatus}`)}`} />
            {u.email && (
              <Mark on={u.emailVerified} text={`${t('field.email')}: ${t(u.emailVerified ? 'account.email_verified' : 'account.email_unverified')}`} />
            )}
            <Mark on={u.mfaEnabled} text={`${t('account.mfa')}: ${t(u.mfaEnabled ? 'account.mfa_on' : 'account.mfa_off')}`} />
          </ul>
        </div>
      </section>

      {/* how they stand with others: three cells divided by lines */}
      <dl className={styles.stats}>
        <div>
          <dt>{t('account.rating')}</dt>
          <dd>{trust.isPending && u.id ? '…' : rating}</dd>
        </div>
        <div>
          <dt>{t('account.completed')}</dt>
          <dd>{trust.isPending ? '…' : n(trust.data?.completedTransactions ?? 0)}</dd>
        </div>
        <div>
          <dt>{t('account.member_since')}</dt>
          <dd>{since ?? '–'}</dd>
        </div>
      </dl>

      {u.accountStatus === 'suspended' && <FormMessage kind="info">{t('account.suspended')}</FormMessage>}

      <div className={styles.columns}>
        <section aria-labelledby="profile-personal">
          <h2 id="profile-personal">{t('account.section_personal')}</h2>
          <dl className={styles.rows}>
            <Row label={t('account.name')} value={u.displayName} />
            {u.phoneMasked && <Row label={t('field.phone')} value={u.phoneMasked} />}
            {u.email && <Row label={t('field.email')} value={u.email} />}
          </dl>
        </section>
        <section aria-labelledby="profile-verification">
          <h2 id="profile-verification">{t('account.section_verification')}</h2>
          <dl className={styles.rows}>
            <Row
              label={t('account.kyc')}
              value={
                <>
                  {t(`kyc.status.${u.kycStatus}`)}
                  {KYC_ACTION[u.kycStatus] && (
                    <>
                      {' '}
                      <a href="/account/kyc">{t('account.kyc_start')}</a>
                    </>
                  )}
                </>
              }
            />
            {u.email && <Row label={t('field.email')} value={`${u.email} (${t(u.emailVerified ? 'account.email_verified' : 'account.email_unverified')})`} />}
            <Row label={t('account.mfa')} value={t(u.mfaEnabled ? 'account.mfa_on' : 'account.mfa_off')} />
          </dl>
        </section>
      </div>

      <ul className={styles.ruledLinks}>
        <li>
          <Link to="/seller">{t('account.seller_link')}</Link>
        </li>
        <li>
          <Link to="/account/payout">{t('account.payout_link')}</Link>
        </li>
      </ul>
      <button type="button" className={styles.signOut} onClick={() => void signOut()} disabled={busy}>
        {t('account.sign_out')}
      </button>
    </div>
  );
}

function Mark({ on, text }: { on: boolean; text: string }) {
  return (
    <li data-on={on || undefined}>
      <span className={styles.dot} aria-hidden="true" />
      {text}
    </li>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function SignInPrompt({ next }: { next: string }) {
  const { t } = useAccountT();
  return (
    <div className={styles.narrow}>
      <h1>{t('account.signed_out_title')}</h1>
      <p>{t('account.signed_out_text')}</p>
      <p>
        <Link to={`/signin?next=${encodeURIComponent(next)}`}>{t('signin.link')}</Link>
      </p>
    </div>
  );
}
