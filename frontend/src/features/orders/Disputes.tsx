// Disputes on the order view (docs/design/08_frontend.pdf section 7.7; Unit 7 section 5; FR-DSP-01 to FR-DSP-11;
// U8-09). The buyer opens one from the order, with only the types allowed now (I-56), a description of at least 20
// characters and up to 10 images (CP-33), after confirm.open_dispute. The dispute tab shows the status, the seller's
// response deadline and the decision target as countdowns, both parties' statements, one's own evidence, and after
// the decision the outcome and its reason. Withdrawing states confirm.withdraw_dispute with the new auto-release time.
// The order's disputes come from GET /orders/{id}/disputes (both parties; Decisions log, U8-09).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { ActionCell, Panel } from '../../shared/ui';
import { Moment } from '../../shared/Moment';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { FRESHNESS } from '../../shared/query';
import { OpenDispute } from './OpenDispute';
import { orderKey, type OrderView } from './model';
import styles from './orders.module.css';

import { disputeKey, disputesKey, LIVE, MAX_VIDEOS, usableEvidence, type DisputeSummary, type DisputeView } from './disputeModel';

export { disputesKey, MAX_VIDEOS, usableEvidence };
export type { DisputeSummary, DisputeView };

export function useOrderDisputes(o: OrderView) {
  const api = useApi();
  return useQuery({
    queryKey: disputesKey(o.id),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(o.id)}/disputes`, { signal }) as Promise<{ items: DisputeSummary[] }>,
    staleTime: FRESHNESS.money,
    retry: false,
    enabled: o.status === 'paid' || o.status === 'closed',
  });
}

export function useDispute(id: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: disputeKey(id ?? ''),
    queryFn: ({ signal }) => api.get(`/disputes/${encodeURIComponent(id ?? '')}`, { signal }) as Promise<DisputeView>,
    staleTime: FRESHNESS.money,
    retry: false,
    enabled: id !== null,
  });
}

/**
 * The dispute slot of the order page (rail, U10-23; the same slot in every state): before a dispute, the way to open one (greyed until it is allowed); after it,
 * a small block: its status, deadlines, a confirmation that what was sent arrived, the chat with TrustBazaar (a page of its own, where each party talks only to
 * TrustBazaar, never to the other party), adding a photo or video, and for the buyer the withdrawal. The text of the complaint is not repeated here.
 */
export function DisputeSlot({ o, items, t, lang }: { o: OrderView; items: DisputeSummary[]; t: T; lang: Lang }) {
  const latest = items[0] ?? null;
  const live = latest !== null && LIVE.includes(latest.status);
  const dispute = useDispute(latest?.id ?? null);
  const [sent, setSent] = useState<{ failed: string | null } | null>(null);
  const now = useServerNow();
  // a dispute is for what came (or did not come): only once the item is handed over or sent, or the seller's deadline has passed
  const received = o.deliveryEventAt !== null || (o.fulfilmentDueAt !== null && Date.parse(o.fulfilmentDueAt) < now);
  const d = dispute.data;
  const deadlines: [string, string | null][] =
    d && live
      ? [
          ['dispute.deadline.seller', d.status === 'open' ? d.sellerDueAt : null],
          ['dispute.deadline.info', d.status === 'awaiting_seller' ? d.infoDueAt : null],
          ['dispute.deadline.decision', d.decisionTargetAt],
        ]
      : [];
  return (
    <>
      {d && (
        <Panel title={t('dispute.slot_title')} className={styles.panel}>
          <dl className={styles.statusGrid}>
            <div>
              <dt>{t('handover.status_label')}</dt>
              <dd>{t(`dispute.state.${d.status}`)}</dd>
            </div>
            <div>
              <dt>{t('dispute.type')}</dt>
              <dd>{t(`dispute.type.${d.type}`)}</dd>
            </div>
          </dl>
          {deadlines.some(([, at]) => at) && (
            <dl className={styles.deadlineGrid}>
              {deadlines
                .filter(([, at]) => at)
                .map(([key, at]) => (
                  <div key={key}>
                    <dt>{t(key)}</dt>
                    <dd>
                      <Moment at={Date.parse(at as string)} now={now} t={t} lang={lang} />
                    </dd>
                  </div>
                ))}
            </dl>
          )}
          {d.outcome && (
            <dl className={styles.statusGrid}>
              <div>
                <dt>{t('dispute.outcome_title')}</dt>
                <dd>{t(`dispute.outcome.${d.outcome.kind}`, { amount: d.outcome.itemRefund ? formatMoney(BigInt(d.outcome.itemRefund), lang) : '' })}</dd>
              </div>
            </dl>
          )}
          {sent &&
            live &&
            (sent.failed ? <FormMessage kind="error">{sent.failed}</FormMessage> : <FormMessage kind="success">{t('dispute.sent')}</FormMessage>)}
          <ActionCell as={Link} to={`/disputes/${encodeURIComponent(d.id)}`}>
            {t('dispute.open_chat')}
            {(latest?.unseen ?? 0) > 0 && (
              <>
                <span className={styles.badge} aria-hidden="true">
                  {toLocalDigits(String(latest?.unseen ?? 0), lang)}
                </span>
                <span className={styles.srOnly}>{t('dispute.unseen', { n: toLocalDigits(String(latest?.unseen ?? 0), lang) })}</span>
              </>
            )}
          </ActionCell>
        </Panel>
      )}
      {dispute.isError && <FormMessage kind="error">{errorText(dispute.error, t, lang)}</FormMessage>}
      {o.role === 'buyer' &&
        !live &&
        o.status === 'paid' &&
        (received ? (
          <OpenDispute o={o} t={t} lang={lang} onOpened={(failed) => setSent({ failed })} />
        ) : (
          <Panel title={t('dispute.slot_title')} className={styles.panel}>
            <ActionCell disabled aria-describedby="dispute-not-yet">
              {t('dispute.open_button')}
            </ActionCell>
            <p id="dispute-not-yet" className={styles.hint}>
              {t('dispute.not_yet')}
            </p>
          </Panel>
        ))}
    </>
  );
}

export function useRefresh(d: DisputeView) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: disputeKey(d.id) });
    void queryClient.invalidateQueries({ queryKey: orderKey(d.orderId) });
  };
}

export function Withdraw({ d, o, t, lang }: { d: DisputeView; o: OrderView | null; t: T; lang: Lang }) {
  const api = useApi();
  const refresh = useRefresh(d);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const withdraw = useMutation({
    mutationFn: () => api.post(`/disputes/${encodeURIComponent(d.id)}/withdraw`, {}),
    onSuccess: () => {
      setConfirming(false);
      refresh();
    },
    onError: (e) => {
      setConfirming(false);
      setMessage(errorText(e, t, lang));
      refresh();
    },
  });
  const at = o?.escrow?.autoReleaseAt ? formatDateTime(Date.parse(o.escrow.autoReleaseAt), lang) : t('dispute.release_time_unknown');
  return (
    <div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <ActionCell onClick={() => setConfirming(true)}>{t('dispute.withdraw')}</ActionCell>
      {confirming && (
        <ConfirmDialog
          id="withdraw-dispute"
          title={t('dispute.withdraw')}
          busy={withdraw.isPending}
          confirmLabel={t('dispute.withdraw_button')}
          cancelLabel={t('actions.back')}
          onConfirm={() => withdraw.mutate()}
          onCancel={() => setConfirming(false)}
        >
          <p>{t('confirm.withdraw_dispute', { at })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
