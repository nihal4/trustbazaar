// Four-eyes approvals, /staff/approvals (FR-OPS-05; Unit 1 section 6.8; section 7.9; U8-10): the open proposals for
// my role, never my own (the server leaves them out), with what each would do, who asked for it and why, and when it
// expires. Approving runs the action at once, so it is confirmed first; either decision may carry a note.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatDeadline } from '../lib/time.js';
import { useApi } from '../shared/api';
import { useServerNow } from '../shared/clock';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { errorText } from '../shared/errors';
import { FormMessage } from '../shared/form';
import type { T } from '../shared/language/catalogue';
import type { Lang } from '../shared/language/lang';
import { APPROVAL_ACTIONS, type Approval } from './model';
import { useStaffT } from './text';
import styles from './staff.module.css';
import { Button, Field, Textarea } from '../shared/ui';

const approvalsKey = ['staff', 'approvals'] as const;

export function Component() {
  const { t, lang } = useStaffT();
  const api = useApi();
  const approvals = useQuery({
    queryKey: approvalsKey,
    queryFn: ({ signal }) => api.get('/staff/approvals', { signal }) as Promise<Approval[]>,
    staleTime: 0,
    refetchInterval: 60_000,
    retry: false,
  });
  return (
    <div>
      <h1>{t('staff.approvals.title')}</h1>
      <p className={styles.hint}>{t('staff.approvals.explain')}</p>
      {approvals.isPending && <p role="status">{t('shell.loading')}</p>}
      {approvals.isError && <FormMessage kind="error">{errorText(approvals.error, t, lang)}</FormMessage>}
      {approvals.isSuccess && approvals.data.length === 0 && <p>{t('staff.approvals.none')}</p>}
      <ul className={styles.items}>
        {(approvals.data ?? []).map((a) => (
          <ApprovalItem key={a.id} a={a} t={t} lang={lang} />
        ))}
      </ul>
    </div>
  );
}

function ApprovalItem({ a, t, lang }: { a: Approval; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const now = useServerNow();
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') =>
      api.post(`/staff/approvals/${encodeURIComponent(a.id)}/decision`, { decision, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      setDeciding(null);
      void queryClient.invalidateQueries({ queryKey: approvalsKey });
    },
    onError: (e) => {
      setDeciding(null);
      setMessage(errorText(e, t, lang));
      void queryClient.invalidateQueries({ queryKey: approvalsKey });
    },
  });
  const action = APPROVAL_ACTIONS.has(a.action) ? t(`staff.approval.${a.action}`) : a.action;
  const details = Object.entries(a.payload ?? {}).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v));
  const noteId = `note-${a.id}`;
  return (
    <li className={styles.card} aria-labelledby={`approval-${a.id}`}>
      <h2 id={`approval-${a.id}`}>{action}</h2>
      <dl className={styles.facts}>
        <dt>{t('staff.approvals.target')}</dt>
        <dd>{t('staff.approvals.target_value', { type: a.targetType, id: a.targetId.slice(0, 8) })}</dd>
        <dt>{t('staff.approvals.reason')}</dt>
        <dd className={styles.text}>{a.reason}</dd>
        <dt>{t('staff.approvals.proposed')}</dt>
        <dd>{formatDateTime(Date.parse(a.proposedAt), lang)}</dd>
        <dt>{t('staff.approvals.expires')}</dt>
        <dd>{formatDeadline(Date.parse(a.expiresAt), now, lang)}</dd>
        {details.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
      </dl>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <Field id={noteId} label={t('staff.approvals.note')}>
        {(control) => <Textarea {...control} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <p className={styles.buttons}>
        <Button
          variant="primary"
          type="button"
          onClick={() => {
            setMessage(null);
            setDeciding('approved');
          }}
        >
          {t('staff.approvals.approve')}
        </Button>
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            setMessage(null);
            setDeciding('rejected');
          }}
        >
          {t('staff.approvals.reject')}
        </Button>
      </p>
      {deciding && (
        <ConfirmDialog
          id={`decide-${a.id}`}
          title={t(deciding === 'approved' ? 'staff.approvals.confirm_approve' : 'staff.approvals.confirm_reject', { action })}
          busy={decide.isPending}
          confirmLabel={t(deciding === 'approved' ? 'staff.approvals.approve' : 'staff.approvals.reject')}
          cancelLabel={t('staff.approvals.back')}
          onConfirm={() => decide.mutate(deciding)}
          onCancel={() => setDeciding(null)}
        >
          <p>{t(deciding === 'approved' ? 'staff.approvals.approve_consequence' : 'staff.approvals.reject_consequence')}</p>
        </ConfirmDialog>
      )}
    </li>
  );
}
