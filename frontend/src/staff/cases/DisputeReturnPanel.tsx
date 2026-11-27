// The return of an item after an upheld meetup claim: the seller's check, the mismatch signal and how the operator closes the return or records a finding about
// the buyer.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from '../staff.module.css';
import { Action, Choice } from './common';
import { CaseFile, caseKey } from './disputeTypes';

/** U10-23 (FR-TNS-10): the seller's check of the returned item, the operator's way out of a stuck return, and the finding of a buyer's bad faith. */
export function ReturnPanel({ f, rc, t, lang }: { f: CaseFile; rc: NonNullable<CaseFile['returnCheck']>; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const id = f.dispute.id;
  const [outcome, setOutcome] = useState<'refund' | 'release' | ''>('');
  const [finding, setFinding] = useState<'false_claim' | 'swap' | ''>('');
  const refresh = () => void queryClient.invalidateQueries({ queryKey: caseKey(id) });
  const awaiting = f.dispute.status === 'awaiting_return';
  if (!awaiting && rc.checks.length === 0 && !rc.finding && rc.findings.length === 0) return null;
  return (
    <>
      <section className={styles.panel} aria-labelledby="dispute-return">
        <h2 id="dispute-return">{t('staff.return.title')}</h2>
        {rc.checks.length === 0 ? (
          <p>{t(awaiting ? 'staff.return.not_checked' : 'staff.return.none')}</p>
        ) : (
          <ul className={styles.items}>
            {rc.checks.map((c, i) => (
              <li key={i}>
                {formatDateTime(Date.parse(c.at), lang)} · {t(c.matched ? 'staff.return.matched' : 'staff.return.mismatch')}
              </li>
            ))}
          </ul>
        )}
        {rc.finding && (
          <p>
            <strong>{t(`staff.finding.${rc.finding.finding}`)}</strong> · {formatDateTime(Date.parse(rc.finding.at), lang)} · {rc.finding.reason}
          </p>
        )}
      </section>
      {rc.canResolve && (
        <Action
          title={t('staff.return.resolve_title')}
          button={t('staff.return.resolve_button')}
          minReason={20}
          t={t}
          lang={lang}
          consequence={t(outcome === 'release' ? 'staff.return.consequence_release' : 'staff.return.consequence_refund')}
          valid={outcome !== ''}
          invalidText={t('staff.return.choose')}
          run={(reason) => api.post(`/staff/disputes/${encodeURIComponent(id)}/resolve-return`, { outcome, reason })}
          done={() => t('staff.return.resolved')}
          onDone={refresh}
        >
          <p className={styles.hint}>{t('staff.return.resolve_hint')}</p>
          <Choice
            legend={t('staff.return.outcome')}
            name="return-outcome"
            value={outcome}
            options={[
              ['refund', t('staff.return.refund')],
              ['release', t('staff.return.release')],
            ]}
            onChange={setOutcome}
          />
        </Action>
      )}
      {rc.findings.length > 0 && (
        <Action
          title={t('staff.finding.title')}
          button={t('staff.finding.button')}
          minReason={20}
          t={t}
          lang={lang}
          consequence={t(finding === 'swap' ? 'staff.finding.consequence_swap' : 'staff.finding.consequence_false')}
          valid={finding !== ''}
          invalidText={t('staff.finding.choose')}
          run={(reason) => api.post(`/staff/disputes/${encodeURIComponent(id)}/buyer-finding`, { finding, reason })}
          done={(r) => t((r as { suspended: boolean }).suspended ? 'staff.finding.done_suspended' : 'staff.finding.done')}
          onDone={refresh}
        >
          <p className={styles.hint}>{t('staff.finding.hint')}</p>
          <Choice
            legend={t('staff.finding.kind')}
            name="finding-kind"
            value={finding}
            options={rc.findings.map((k) => [k, t(`staff.finding.${k}`)] as ['false_claim' | 'swap', string])}
            onChange={setFinding}
          />
        </Action>
      )}
    </>
  );
}
