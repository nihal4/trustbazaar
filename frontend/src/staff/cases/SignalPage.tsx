// Flagged activity, /staff/signals/:id (FR-OPS-01, FR-OPS-02; Unit 7 section 2.3; U8-10): what the signal saw, as
// the server records it, and its review. By kind: a shill-bidding flag may cancel the auction (FR-LST-08); a
// re-listing opens the listing; a delivery issue is resolved; a member it names can be sanctioned.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { queueKey } from '../model';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Action, CaseFrame, Choice, Facts, short, staffError } from './common';
import { useQueued } from './queued';
import { UserActions } from './UserActions';

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useStaffT();
  const api = useApi();
  const queryClient = useQueryClient();
  const q = useQueued('flagged_activity', id);
  const [outcome, setOutcome] = useState<'dismissed' | 'actioned' | ''>('');
  const sig = q.item;
  const detail = (sig?.detail ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof detail[k] === 'string' ? (detail[k] as string) : '');
  const kind = typeof sig?.kind === 'string' ? sig.kind : '';
  const subject = typeof sig?.subjectUser === 'string' ? sig.subjectUser : '';
  return (
    <CaseFrame title={t('staff.signal.title', { ref: short(id) })} back="/staff/queues/flagged_activity" t={t}>
      {q.isPending && <p role="status">{t('shell.loading')}</p>}
      {q.isError && <FormMessage kind="error">{staffError(q.error, t, lang)}</FormMessage>}
      {q.isSuccess && !sig && <FormMessage kind="info">{t('staff.case.not_open')}</FormMessage>}
      {sig && (
        <>
          <section className={styles.panel} aria-labelledby="signal-facts">
            <h2 id="signal-facts">{t('staff.signal.facts')}</h2>
            <Facts rows={[
              [t('staff.signal.kind'), kind],
              [t('staff.signal.raised'), formatDateTime(Date.parse(sig.since), lang)],
              [t('staff.signal.member'), subject ? short(subject) : null],
              ...Object.entries(detail).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => [k, String(v)] as [string, string]),
            ]} />
            {str('listingId') && <p><Link className={styles.openLink} to={`/staff/listings/${encodeURIComponent(str('listingId'))}`}>{t('staff.report.open_listing', { ref: short(str('listingId')) })}</Link></p>}
          </section>
          <Action title={t('staff.signal.review_title')} button={t('staff.signal.review_button')} consequence={t('staff.signal.review_consequence')} t={t} lang={lang}
            reasonLabel={t('staff.signal.note')} valid={outcome !== ''} invalidText={t('staff.report.choose')}
            run={(note) => api.post(`/staff/signals/${encodeURIComponent(id)}/review`, { outcome, note })}
            done={() => t('staff.signal.reviewed')} onDone={() => void queryClient.invalidateQueries({ queryKey: queueKey('flagged_activity') })}>
            <Choice legend={t('staff.report.outcome')} name="signal-outcome" value={outcome}
              options={[['dismissed', t('staff.review.dismissed')], ['actioned', t('staff.review.actioned')]]} onChange={setOutcome} />
          </Action>
          {kind === 'shill_bidding' && str('auctionId') && (
            <Action title={t('staff.signal.cancel_title')} button={t('staff.signal.cancel_button')} consequence={t('staff.signal.cancel_consequence')} t={t} lang={lang}
              run={(reason) => api.post(`/staff/auctions/${encodeURIComponent(str('auctionId'))}/cancel`, { reason })} done={() => t('staff.signal.cancelled')} />
          )}
          {kind === 'delivery_issue' && str('issueId') && (
            <Action title={t('staff.signal.issue_title')} button={t('staff.signal.issue_button')} consequence={t('staff.signal.issue_consequence')} t={t} lang={lang}
              run={(reason) => api.post(`/staff/delivery/issues/${encodeURIComponent(str('issueId'))}/resolve`, { reason })} done={() => t('staff.signal.issue_done')} />
          )}
          {subject && <UserActions userId={subject} related={{ type: 'signal', id }} t={t} lang={lang} />}
        </>
      )}
    </CaseFrame>
  );
}
