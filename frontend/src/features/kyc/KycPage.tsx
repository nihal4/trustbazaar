// The KYC wizard (IF-UI-02, NFR-USE-02; section 5.2), in kyc.html, the only document allowed the camera.
// The requirements come before any capture; the review status is shown above every step; the images
// stay in memory and are sent once, at the end, to POST /kyc/submissions (multipart, through
// lib/api.js). Files already sent are shown only through Unit 1's signed links. Daylight layout (docs/design/10_visual.md,
// section 7.9): the four steps above the camera, and from 60rem a side panel with the photo rules and who sees the ID.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';

import { errorText } from '../../shared/errors';

import { FormMessage } from '../../shared/form';

import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';

import { useKycT } from './common';
import { maySubmit, reasonKey, STATUS_KEY, type ImageKind, type KycStatusView } from './model';
import styles from './kyc.module.css';
import { Button } from '../../shared/ui';
import { Wizard } from './KycWizard';

export function Component() {
  const { t, lang } = useKycT();
  const api = useApi();
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: ({ signal }) => api.get('/kyc/status', { signal }) as Promise<KycStatusView>,
    staleTime: FRESHNESS.account,
    retry: false,
  });

  if (status.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (status.isError) {
    if (isApiError(status.error, 401)) {
      return (
        <div className={styles.narrow}>
          <h1>{t('kyc.title')}</h1>
          <p>{t('kyc.signed_out')}</p>
          <p>
            <a href={`/signin?next=${encodeURIComponent('/account/kyc')}`}>{t('kyc.sign_in')}</a>
          </p>
        </div>
      );
    }
    return <FormMessage kind="error">{errorText(status.error, t, lang)}</FormMessage>;
  }

  const s = status.data;
  return (
    <div className={maySubmit(s) ? styles.page : styles.narrow}>
      <h1>{t('kyc.title')}</h1>
      <StatusBar status={s} />
      {maySubmit(s) ? <Wizard /> : <AfterSubmission status={s} />}
    </div>
  );
}

/** NFR-USE-02: the review status, on every step; after a rejection, the reason and what to do. */
function StatusBar({ status }: { status: KycStatusView }) {
  const { t, lang } = useKycT();
  const d = (n: number) => toLocalDigits(String(n), lang);
  const reason = status.rejection ? reasonKey(status.rejection.reason) : null;
  return (
    <section className={styles.status} aria-labelledby="kyc-status-title" aria-live="polite">
      <h2 id="kyc-status-title">{t('status.title')}</h2>
      <p>
        <strong>{t(`status.${status.status}`)}</strong>
      </p>
      {status.status === 'pending_review' && <p>{t('status.expected', { hours: d(status.expectedReviewHours) })}</p>}
      {status.status === 'verified' && <p>{t('status.verified_since', { at: formatDateTime(Date.parse(status.changedAt), lang) })}</p>}
      {reason && (
        <>
          <p>{t(`reason.${reason}`)}</p>
          {status.rejection?.note && <p>{t('status.note', { note: status.rejection.note })}</p>}
        </>
      )}
      {status.status === 'rejected' && (
        <p>{status.submissionsLeft > 0 ? t('status.attempts_left', { n: d(status.submissionsLeft) }) : t('status.no_attempts')}</p>
      )}
    </section>
  );
}

/** Pending, verified, revoked, or no attempts left: the images already sent, through signed links. */
function AfterSubmission({ status }: { status: KycStatusView }) {
  const { t, lang } = useKycT();
  const api = useApi();
  const [links, setLinks] = useState<{ kind: ImageKind; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status.status === 'unsubmitted') return null;

  const show = async () => {
    setBusy(true);
    setError(null);
    const found: { kind: ImageKind; url: string }[] = [];
    try {
      for (const kind of ['doc_front', 'doc_back', 'passport_photo_page', 'selfie_neutral', 'selfie_action'] as ImageKind[]) {
        try {
          const r: { url: string } = await api.post(`/kyc/files/${kind}/view`, {});
          if (r.url.startsWith('/api/v1/files/v/')) found.push({ kind, url: r.url });
        } catch (e) {
          if (!isApiError(e, 404)) throw e; // a kind this document does not have
        }
      }
      setLinks(found);
    } catch (e) {
      setError(errorText(e, t, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="kyc-sent-title" className={styles.sent}>
      <h2 id="kyc-sent-title">{t('sent.title')}</h2>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {links === null ? (
        <Button variant="secondary" type="button" onClick={() => void show()} disabled={busy}>
          {t('sent.show')}
        </Button>
      ) : (
        <ul className={styles.thumbs}>
          {links.map((l) => (
            <li key={l.kind}>
              <img src={l.url} alt={t(`image.${l.kind}.title`)} className={styles.preview} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
