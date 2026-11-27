// A bank payout account to check, /staff/payout-accounts/:id (FR-PAY-21; Unit 2 section 7; U8-10): the account's
// name beside the member's verified legal name (the read is audited by the server), approved or rejected with a
// reason. An approved account takes effect after its cooling-off period.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { queueKey } from '../model';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Action, CaseFrame, Choice, Facts, short, staffError } from './common';

interface Pending {
  id: string;
  userId: string;
  kind: string;
  status: string;
  bankName: string | null;
  branchName: string | null;
  accountName: string | null;
  accountLast4: string | null;
  routingNumber: string | null;
  kycLegalName: string;
  createdAt: string;
}

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useStaffT();
  const api = useApi();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<'approve' | 'reject' | ''>('');
  const pending = useQuery({
    queryKey: ['staff', 'payout-accounts', 'pending'],
    queryFn: ({ signal }) => api.get('/staff/payout-accounts/pending', { signal }) as Promise<{ items: Pending[] }>,
    staleTime: 0,
    retry: false,
  });
  const a = pending.data?.items.find((x) => x.id === id) ?? null;
  return (
    <CaseFrame title={t('staff.payout.title', { ref: short(id) })} back="/staff/queues/payout_accounts" t={t}>
      {pending.isPending && <p role="status">{t('shell.loading')}</p>}
      {pending.isError && <FormMessage kind="error">{staffError(pending.error, t, lang)}</FormMessage>}
      {pending.isSuccess && !a && <FormMessage kind="info">{t('staff.case.not_open')}</FormMessage>}
      {a && (
        <>
          <section className={styles.panel} aria-labelledby="payout-facts">
            <h2 id="payout-facts">{t('staff.payout.compare')}</h2>
            <p className={styles.hint}>{t('staff.payout.explain')}</p>
            <Facts
              rows={[
                [t('staff.payout.account_name'), <strong key="n">{a.accountName ?? '—'}</strong>],
                [t('staff.payout.legal_name'), <strong key="k">{a.kycLegalName}</strong>],
                [t('staff.payout.bank'), [a.bankName, a.branchName].filter(Boolean).join(', ')],
                [t('staff.payout.account'), a.accountLast4 ? `•••• ${a.accountLast4}` : null],
                [t('staff.payout.routing'), a.routingNumber],
                [t('staff.payout.added'), formatDateTime(Date.parse(a.createdAt), lang)],
              ]}
            />
          </section>
          <Action
            title={t('staff.payout.decide_title')}
            button={t('staff.payout.decide_button')}
            t={t}
            lang={lang}
            maxReason={500}
            consequence={t(decision === 'reject' ? 'staff.payout.reject_consequence' : 'staff.payout.approve_consequence')}
            valid={decision !== ''}
            invalidText={t('staff.report.choose')}
            run={(reason) => api.post(`/staff/payout-accounts/${encodeURIComponent(id)}/decision`, { decision, reason })}
            done={() => t(decision === 'reject' ? 'staff.payout.rejected' : 'staff.payout.approved')}
            onDone={() => {
              void queryClient.invalidateQueries({ queryKey: queueKey('payout_accounts') });
              void queryClient.invalidateQueries({ queryKey: ['staff', 'payout-accounts', 'pending'] });
            }}
          >
            <Choice
              legend={t('staff.payout.decision')}
              name="payout-decision"
              value={decision}
              options={[
                ['approve', t('staff.payout.approve')],
                ['reject', t('staff.payout.reject')],
              ]}
              onChange={setDecision}
            />
          </Action>
        </>
      )}
    </CaseFrame>
  );
}
