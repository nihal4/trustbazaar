// A report, /staff/reports/:id (FR-TNS-01, FR-OPS-02; section 7.9; U8-10): what was reported and the reporter's own
// words (Decisions log, U8-10), resolved with a written resolution by the operator who claimed it; a reported listing
// opens in the console, and the member it concerns can be sanctioned from here.
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
  const q = useQueued('reports', id);
  const [outcome, setOutcome] = useState<'dismissed' | 'actioned' | ''>('');
  const r = q.item;
  const s = (k: string) => (r && typeof r[k] === 'string' ? (r[k] as string) : '');
  return (
    <CaseFrame title={t('staff.report.title', { ref: short(id) })} back="/staff/queues/reports" t={t}>
      {q.isPending && <p role="status">{t('shell.loading')}</p>}
      {q.isError && <FormMessage kind="error">{staffError(q.error, t, lang)}</FormMessage>}
      {q.isSuccess && !r && <FormMessage kind="info">{t('staff.case.not_open')}</FormMessage>}
      {r && (
        <>
          <section className={styles.panel} aria-labelledby="report-facts">
            <h2 id="report-facts">{t('staff.report.facts')}</h2>
            <Facts rows={[
              [t('staff.report.target'), s('targetType') === 'listing'
                ? <Link to={`/staff/listings/${encodeURIComponent(s('targetId'))}`}>{t('staff.report.open_listing', { ref: short(s('targetId')) })}</Link>
                : t('staff.report.member', { ref: short(s('targetId')) })],
              [t('staff.report.category'), s('category')],
              [t('staff.report.made'), formatDateTime(Date.parse(r.since), lang)],
              [t('staff.report.status'), r.status],
            ]} />
            <h3>{t('staff.report.text')}</h3>
            <p className={styles.text}>{s('text') || t('staff.report.no_text')}</p>
          </section>
          <Action title={t('staff.report.resolve_title')} button={t('staff.report.resolve_button')} consequence={t('staff.report.resolve_consequence')} t={t} lang={lang}
            reasonLabel={t('staff.report.resolution')} valid={outcome !== ''} invalidText={t('staff.report.choose')}
            run={(resolution) => api.post(`/staff/reports/${encodeURIComponent(id)}/resolution`, { outcome, resolution })}
            done={() => t('staff.report.resolved')} onDone={() => void queryClient.invalidateQueries({ queryKey: queueKey('reports') })}>
            <Choice legend={t('staff.report.outcome')} name="report-outcome" value={outcome}
              options={[['dismissed', t('staff.review.dismissed')], ['actioned', t('staff.review.actioned')]]} onChange={setOutcome} />
          </Action>
          {s('subjectUser') && <UserActions userId={s('subjectUser')} related={{ type: 'report', id }} t={t} lang={lang} />}
        </>
      )}
    </CaseFrame>
  );
}
