// A KYC submission, /staff/kyc/:id (FR-KYC-06, SEC-ACC-06; section 7.9; U8-10): for the operator who claimed it.
// Each document image opens only after a reason is given, which the server records with the view, by a signed link
// that expires (CP-31). Approve, or reject with one of the fixed reasons; the operator's reason goes with it as the
// note (FR-OPS-02).
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { queueKey } from '../model';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Action, CaseFrame, Choice, Facts, short, staffError } from './common';

interface Submission {
  id: string; userId: string; docType: string; docNumber: string; fullName: string; dateOfBirth: string; isAdult: boolean;
  livenessAction: string | null; flags: string[]; submittedAt: string; files: string[];
}
const REJECT = ['image_unreadable', 'selfie_mismatch', 'liveness_failed', 'document_expired', 'details_mismatch', 'underage', 'duplicate_identity', 'blacklisted', 'other'] as const;
type Reject = (typeof REJECT)[number];

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useStaffT();
  const api = useApi();
  const queryClient = useQueryClient();
  const s = useQuery({
    queryKey: ['staff', 'kyc', id],
    queryFn: ({ signal }) => api.get(`/staff/kyc/submissions/${encodeURIComponent(id)}`, { signal }) as Promise<Submission>,
    staleTime: Infinity,
    retry: false,
  });
  const [decision, setDecision] = useState<'approve' | 'reject' | ''>('');
  const [code, setCode] = useState<Reject | ''>('');
  const k = s.data;
  return (
    <CaseFrame title={t('staff.kyc.title', { ref: short(id) })} back="/staff/queues/kyc" t={t}>
      {s.isPending && <p role="status">{t('shell.loading')}</p>}
      {s.isError && <FormMessage kind="error">{staffError(s.error, t, lang)}</FormMessage>}
      {k && (
        <>
          <section className={styles.panel} aria-labelledby="kyc-facts">
            <h2 id="kyc-facts">{t('staff.kyc.facts')}</h2>
            <p className={styles.hint}>{t('staff.kyc.audited')}</p>
            <Facts rows={[
              [t('staff.kyc.doc_type'), k.docType],
              [t('staff.kyc.name'), k.fullName],
              [t('staff.kyc.dob'), k.dateOfBirth],
              [t('staff.kyc.doc_number'), k.docNumber],
              [t('staff.kyc.adult'), t(k.isAdult ? 'staff.yes' : 'staff.no')],
              [t('staff.kyc.liveness'), k.livenessAction],
              [t('staff.kyc.flags'), k.flags.length ? k.flags.join(', ') : t('staff.kyc.no_flags')],
              [t('staff.kyc.submitted'), formatDateTime(Date.parse(k.submittedAt), lang)],
            ]} />
          </section>
          <section className={styles.panel} aria-labelledby="kyc-files">
            <h2 id="kyc-files">{t('staff.kyc.files')}</h2>
            <p className={styles.hint}>{t('staff.kyc.files_explain')}</p>
            <ul className={styles.items}>{k.files.map((f) => <li key={f}><FileView id={id} kind={f} t={t} lang={lang} /></li>)}</ul>
          </section>
          <Action title={t('staff.kyc.decide_title')} button={t('staff.kyc.decide_button')} consequence={t(decision === 'reject' ? 'staff.kyc.reject_consequence' : 'staff.kyc.approve_consequence')}
            t={t} lang={lang} maxReason={500} valid={decision === 'approve' || (decision === 'reject' && code !== '')} invalidText={t('staff.kyc.incomplete')}
            run={(note) => api.post(`/staff/kyc/submissions/${encodeURIComponent(id)}/decision`, { decision, ...(decision === 'reject' ? { reason: code } : {}), note })}
            done={(r) => t(`staff.kyc.${(r as { status: string }).status === 'approved' ? 'approved' : 'rejected'}`)}
            onDone={() => void queryClient.invalidateQueries({ queryKey: queueKey('kyc') })}>
            <Choice legend={t('staff.kyc.decision')} name="kyc-decision" value={decision} options={[['approve', t('staff.kyc.approve')], ['reject', t('staff.kyc.reject')]]} onChange={setDecision} />
            {decision === 'reject' && (
              <Choice legend={t('staff.kyc.reject_reason')} name="kyc-reason" value={code} options={REJECT.map((r) => [r, t(`staff.kyc.reason.${r}`)])} onChange={setCode} />
            )}
          </Action>
        </>
      )}
    </CaseFrame>
  );
}

function FileView({ id, kind, t, lang }: { id: string; kind: string; t: T; lang: Lang }) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = t(`staff.kyc.file.${kind}`);
  const show = async () => {
    setError(null);
    if (reason.trim().length < 10) { setError(t('staff.action.reason_short', { min: '10' })); return; }
    try {
      setLink((await api.post(`/staff/kyc/submissions/${encodeURIComponent(id)}/files/${encodeURIComponent(kind)}/view`, { reason: reason.trim() })) as typeof link);
      setAsking(false);
    } catch (e) {
      setError(staffError(e, t, lang));
    }
  };
  if (link) return <p>{label}: <a href={link.url} target="_blank" rel="noopener noreferrer">{t('staff.case.open_file')}</a> · {t('staff.kyc.link_until', { at: formatDateTime(Date.parse(link.expiresAt), lang) })}</p>;
  return (
    <div>
      <p>{label} {!asking && <button type="button" className={styles.secondary} onClick={() => setAsking(true)}>{t('staff.kyc.show')}</button>}</p>
      {asking && (
        <div className={styles.field}>
          <label htmlFor={`why-${kind}`}>{t('staff.kyc.why', { file: label })}</label>
          <input id={`why-${kind}`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
          <p><button type="button" className={styles.primary} onClick={() => void show()}>{t('staff.kyc.show_file')}</button></p>
        </div>
      )}
      {error && <FormMessage kind="error">{error}</FormMessage>}
    </div>
  );
}
