// A dispute's case file, /staff/disputes/:id (FR-DSP-05 to FR-DSP-09, FR-GAM-18; section 7.9; U8-10): for the
// operator who claimed it. Names as shown publicly, contact details masked (SEC-ACC-05); evidence opens by signed
// links that expire (CP-31); the chat only through the case. The actions: ask the seller for more, decide with the
// exact split from Unit 2 (a partial refund's split is asked of the server before deciding), and the evidence pack.
// At CP-30 the decision is a proposal a second operator approves.

import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { formatDateTime, formatDeadline } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Action, CaseFrame, Facts, short, staffError } from './common';

import { EvidencePack } from './DisputeEvidencePack';
import { ReturnPanel } from './DisputeReturnPanel';
import { CaseFile, caseKey } from './disputeTypes';
import { Decide } from './DisputeDecide';
import { Chat } from './DisputeChat';
import { GameEvidence } from './DisputeGameEvidence';

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useStaffT();
  const api = useApi();
  const file = useQuery({
    queryKey: caseKey(id),
    queryFn: ({ signal }) => api.get(`/staff/disputes/${encodeURIComponent(id)}/case-file`, { signal }) as Promise<CaseFile>,
    staleTime: 0,
    retry: false,
  });
  return (
    <CaseFrame title={t('staff.dispute.title', { ref: short(id) })} back="/staff/queues/disputes" t={t}>
      {file.isPending && <p role="status">{t('shell.loading')}</p>}
      {file.isError && <FormMessage kind="error">{staffError(file.error, t, lang)}</FormMessage>}
      {file.isSuccess && <CaseBody f={file.data} t={t} lang={lang} />}
    </CaseFrame>
  );
}

function CaseBody({ f, t, lang }: { f: CaseFile; t: T; lang: Lang }) {
  const now = useServerNow();
  const money = (p: string) => formatMoney(BigInt(p), lang);
  const at = (iso: string) => formatDateTime(Date.parse(iso), lang);
  const party = (p: { displayName: string; verified: boolean } | null) => (p ? p.displayName + (p.verified ? ' · ' + t('staff.case.verified') : '') : '—');
  const d = f.dispute;
  const open = d.status !== 'decided' && d.status !== 'withdrawn' && d.status !== 'closed';
  return (
    <>
      <section className={styles.panel} aria-labelledby="dispute-facts">
        <h2 id="dispute-facts">{t('staff.dispute.facts')}</h2>
        <Facts
          rows={[
            [t('staff.dispute.type'), d.type],
            [t('staff.dispute.status'), d.status],
            [t('staff.dispute.opened'), at(d.openedAt)],
            [t('staff.dispute.decide_by'), d.decisionTargetAt ? formatDeadline(Date.parse(d.decisionTargetAt), now, lang) : null],
            [t('staff.dispute.info_due'), d.infoDueAt ? formatDeadline(Date.parse(d.infoDueAt), now, lang) : null],
            [t('staff.dispute.buyer'), party(f.parties.buyer)],
            [t('staff.dispute.seller'), party(f.parties.seller)],
            [t('staff.dispute.item'), f.order.listing.title],
            [t('staff.dispute.collected'), money(f.escrow.amountCollected)],
            [t('staff.dispute.escrow'), f.escrow.state],
          ]}
        />
        <h3>{t('staff.dispute.description')}</h3>
        <p className={styles.text}>{d.description}</p>
        {d.fourEyes && <FormMessage kind="info">{t('staff.dispute.four_eyes')}</FormMessage>}
      </section>

      <section className={styles.panel} aria-labelledby="dispute-statements">
        <h2 id="dispute-statements">{t('staff.dispute.statements')}</h2>
        {f.statements.length === 0 && <p className={styles.hint}>{t('staff.dispute.none')}</p>}
        <ul className={styles.items}>
          {f.statements.map((s, i) => (
            <li key={i}>
              <p>
                <strong>{t(`staff.party.${s.party}`)}</strong> · {at(s.at)}
              </p>
              <p className={styles.text}>{s.text ?? t('staff.dispute.removed')}</p>
            </li>
          ))}
        </ul>
        <h3>{t('staff.dispute.evidence')}</h3>
        {f.evidence.length === 0 && <p className={styles.hint}>{t('staff.dispute.none')}</p>}
        <ul className={styles.items}>
          {f.evidence.map((e) => (
            <li key={e.id}>
              {t(`staff.party.${e.party}`)} · {at(e.at)} ·{' '}
              {e.link ? (
                <a href={e.link.url} target="_blank" rel="noopener noreferrer">
                  {t('staff.case.open_file')}
                </a>
              ) : (
                t('staff.dispute.purged')
              )}
            </li>
          ))}
        </ul>
        <p className={styles.hint}>{t('staff.case.links_expire')}</p>
      </section>

      {f.game && <GameEvidence g={f.game} t={t} lang={lang} />}
      {f.chat && <Chat path={f.chat.path} t={t} lang={lang} />}

      <section className={styles.panel} aria-labelledby="dispute-history">
        <h2 id="dispute-history">{t('staff.dispute.history')}</h2>
        <ol className={styles.items}>
          {f.history.map((h, i) => (
            <li key={i}>
              {at(h.at)} · {h.from ?? '—'} → {h.to} · {h.actor}
              {h.reason ? ` · ${h.reason}` : ''}
            </li>
          ))}
        </ol>
        <p>
          {t('staff.dispute.context', {
            disputes: String(f.context.disputes.length),
            strikes: String(f.context.strikes.length),
            sanctions: String(f.context.sanctions.length),
          })}
        </p>
      </section>

      {f.returnCheck && <ReturnPanel f={f} rc={f.returnCheck} t={t} lang={lang} />}
      {open && d.status !== 'awaiting_return' && <RequestInfo id={d.id} t={t} lang={lang} />}
      {open && d.status !== 'awaiting_return' && <Decide f={f} t={t} lang={lang} />}
      <EvidencePack id={d.id} t={t} lang={lang} />
    </>
  );
}

function RequestInfo({ id, t, lang }: { id: string; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  return (
    <Action
      title={t('staff.dispute.request_title')}
      button={t('staff.dispute.request_button')}
      consequence={t('staff.dispute.request_consequence')}
      reasonLabel={t('staff.dispute.request_note')}
      t={t}
      lang={lang}
      run={(note) => api.post(`/staff/disputes/${encodeURIComponent(id)}/request-info`, { note })}
      done={(r) => t('staff.dispute.request_done', { at: formatDateTime(Date.parse((r as { infoDueAt: string }).infoDueAt), lang) })}
      onDone={() => void queryClient.invalidateQueries({ queryKey: caseKey(id) })}
    />
  );
}
