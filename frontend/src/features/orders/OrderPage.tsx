// The order view (docs/design/08_frontend.pdf sections 7.4 and 7.5; IF-UI-04, IF-UI-05; FR-PAY-01, FR-PAY-02;
// NFR-USE-07, NFR-USE-08; U8-05, U8-06). One screen for buyer and seller, from top to bottom: where the money is, in
// one sentence; every deadline that applies, as a time and a countdown; what can be done now; the fulfilment (the
// meetup handover or the shipments, Unit 4); the dispute (Unit 7); the chat with the other party; after the order
// closes, the ratings (U8-09). While the order awaits payment the
// buyer chooses how to get the item (self pickup, or courier with a binding quote) and pays here. The provider sends
// the buyer back here (/orders/{id}?payment={attempt}&result=...; Decisions log, U2-03 and U8-05): the page never
// treats that return as payment, and checks the order every 2 s for up to 30 s.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { formatCountdown, formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useOpenThread } from '../../shared/chat';
import { useServerNow } from '../../shared/clock';
import { postmarkDate } from '../../shared/Counterfoil';
import { EscrowSteps } from '../../shared/EscrowSteps';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { SimulatedBanner } from '../../shared/SimulatedBanner';
import { Actions } from './Actions';
import { CourierChoice } from './Courier';
import { Deadlines } from './Deadlines';
import { Disputes, useOrderDisputes } from './Disputes';
import { GamePrepare, gameReady, GameTab, useGame } from './Game';
import { Handover, ProposeForm, useHandover } from './Handover';
import { Journey } from './Journey';
import { orderKey, type OrderView } from './model';
import { moneyText } from './moneyText';
import { RETURN_POLL_MS, RETURN_WAIT_MS } from './payment';
import { downloadReceipt, hasReceipt } from './receipt';
import { PaymentSheet } from '../../shared/PaymentSheet';
import { Ratings, useOrderRatings } from './Ratings';
import { Shipments, useShipments } from './Shipments';
import en from '../../messages/en/orders.json';
import bn from '../../messages/bn/orders.json';
import styles from './orders.module.css';

const CATALOGUES = { en, bn };

export type { OrderView } from './model';
export { orderKey } from './model';

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const [params] = useSearchParams();
  const attempt = params.get('payment');
  const failed = params.get('result') === 'failed';
  // the payment return: check every 2 s for up to 30 s while the order still waits for payment (section 7.4)
  const [since] = useState(() => Date.now());
  const [waited, setWaited] = useState(false);
  const order = useQuery({
    queryKey: orderKey(id),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(id)}`, { signal }) as Promise<OrderView>,
    staleTime: FRESHNESS.money,
    retry: false,
    refetchInterval: (q) => (attempt && !failed && !waited && q.state.data?.status === 'awaiting_payment' ? RETURN_POLL_MS : false),
  });
  useEffect(() => {
    if (!attempt || failed) return;
    const timer = setTimeout(() => setWaited(true), Math.max(0, since + RETURN_WAIT_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [attempt, failed, since]);

  if (order.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (order.isError) {
    if (isApiError(order.error, 401)) {
      return <p><Link to={signInPath(`/orders/${id}`)}>{t('order.sign_in')}</Link></p>;
    }
    return isApiError(order.error, 404) ? <h1>{t('order.not_found')}</h1> : <FormMessage kind="error">{errorText(order.error, t, lang)}</FormMessage>;
  }
  return <OrderBody o={order.data} attempt={attempt} failed={failed} waited={waited} t={t} lang={lang} />;
}

function OrderBody({ o, attempt, failed, waited, t, lang }: { o: OrderView; attempt: string | null; failed: boolean; waited: boolean; t: T; lang: Lang }) {
  // the payment sheet belongs to the page, not to the pay panel: the panel goes away the moment the order is paid, and the sheet still has to show it
  const [sheet, setSheet] = useState(false);
  const queryClient = useQueryClient();
  const handover = useHandover(o);
  const shipments = useShipments(o);
  const disputes = useOrderDisputes(o);
  const game = useGame(o);
  const ratings = useOrderRatings(o);
  const awaiting = o.status === 'awaiting_payment';
  return (
    <div className={styles.page}>
      {(awaiting || attempt) && <SimulatedBanner kind="payment" />}
      <header className={styles.head}>
        <span className={styles.thumb}>
          {o.listing.photoKey && <img src={`/api/v1/listing-photos/${encodeURIComponent(o.listing.photoKey)}?size=thumb`} alt="" width={88} height={88} />}
        </span>
        <div className={styles.headText}>
          <h1>{t('order.title', { title: o.listing.title })}</h1>
          <p className={styles.meta}>
            <span className={styles.status}>{t(`order.status.${o.status}`)}</span>
            <span>{t(`order.role.${o.role}`)}</span>
            <Link to={`/listings/${encodeURIComponent(o.listing.id)}`}>{t('order.listing_link')}</Link>
          </p>
        </div>
      </header>
      {o.counterparty && o.counterparty.displayName && (
        <p className={styles.party}>
          <span className={styles.avatar} aria-hidden="true">{Array.from(o.counterparty.displayName)[0]?.toUpperCase()}</span>
          <span className={styles.partyText}><span className={styles.partyRole}>{t(`order.party.${o.role === 'buyer' ? 'seller' : 'buyer'}`)}</span><strong>{o.counterparty.displayName}</strong></span>
        </p>
      )}
      <Money o={o} t={t} lang={lang} />
      {attempt && <Return o={o} failed={failed} waited={waited} t={t} />}
      <Journey o={o} h={handover.data ?? null} shipments={shipments.data?.items ?? []} t={t} />
      {!awaiting && <Deadlines o={o} h={handover.data ?? null} t={t} lang={lang} />}
      {awaiting && o.role === 'buyer' && <PayPanel o={o} t={t} lang={lang} onPay={() => setSheet(true)} />}
      {sheet && (
        <PaymentSheet order={{ id: o.id, total: o.total, key: orderKey(o.id) }} t={t} lang={lang} onReceipt={(p) => { const paid = p as OrderView; downloadReceipt(paid, t, lang, paid.counterparty?.displayName || null); }} onClose={() => setSheet(false)}
          onPaid={() => { setSheet(false); void queryClient.invalidateQueries({ queryKey: orderKey(o.id) }); }} />
      )}
      {o.cancelledAt && o.cancelReason && CANCEL_REASONS.includes(o.cancelReason) && <p className={styles.hint}>{t(`order.cancel_reason.${o.cancelReason}`)}</p>}
      {handover.data && <Handover o={o} h={handover.data} t={t} lang={lang} />}
      {handover.isError && <FormMessage kind="error">{errorText(handover.error, t, lang)}</FormMessage>}
      {shipments.data && <Shipments o={o} items={shipments.data.items} t={t} lang={lang} />}
      {shipments.isError && <FormMessage kind="error">{errorText(shipments.error, t, lang)}</FormMessage>}
      {game.data && o.status !== 'awaiting_payment' && <GameTab o={o} g={game.data} t={t} lang={lang} />}
      {game.isError && o.status !== 'awaiting_payment' && <FormMessage kind="error">{errorText(game.error, t, lang)}</FormMessage>}
      <Actions o={o} t={t} lang={lang} extra={handover.data && (handover.data.status === 'arranging' || handover.data.status === 'agreed') ? <ProposeForm o={o} h={handover.data} t={t} lang={lang} /> : undefined} />
      {disputes.data && <Disputes o={o} items={disputes.data.items} t={t} lang={lang} />}
      <OrderChat o={o} t={t} lang={lang} />
      {ratings.data && <Ratings o={o} r={ratings.data} t={t} lang={lang} />}
    </div>
  );
}

/** The reasons the server gives for a cancelled order (the order_cancel_reason enum), each in words; an unknown code is not shown. */
const CANCEL_REASONS = ['checkout_expired', 'payment_window_expired', 'buyer_abandoned', 'listing_withdrawn'];

/**
 * Where the order is: payment, the handover (or delivery), and the end; each step done, current or still to come, in
 * words for screen readers. A cancelled order has none.
 */
export function stepsOf(o: OrderView): { key: 'payment' | 'handover' | 'done'; state: 'done' | 'current' | 'next' }[] {
  if (o.status === 'cancelled') return [];
  const at = o.status === 'awaiting_payment' ? 0 : o.status === 'closed' ? 3 : o.deliveryEventAt === null ? 1 : 2;
  return (['payment', 'handover', 'done'] as const).map((key, i) => ({ key, state: i < at ? 'done' : i === at ? 'current' : 'next' }));
}

/** The day the money left TrustBazaar, for the postmark: paid out to the seller or refunded to the buyer. */
export function postmarkOf(o: OrderView, lang: Lang): string | undefined {
  const out = o.escrow && ['released', 'refunded', 'partially_refunded'].includes(o.escrow.state);
  if (!out || !o.closedAt) return undefined;
  return postmarkDate(o.closedAt, lang);
}

/**
 * Where the money is (AC-ORD-2): a ruled panel under a vermilion rule: the label, the total once, one sentence on where the money is (NFR-USE-07),
 * the day it left TrustBazaar once it has, and the three steps as balls on a line with the current one marked, in words too. While the buyer still has
 * to pay, the payment panel below says what to do and the sentence says it is not paid yet. A cancelled order has no steps.
 */
function Money({ o, t, lang }: { o: OrderView; t: T; lang: Lang }) {
  const steps = stepsOf(o);
  const now = steps.find((s) => s.state === 'current');
  const current = steps.length === 0 ? null : now ? ({ payment: 'in', handover: 'held', done: 'out' } as const)[now.key] : 'done';
  const out = postmarkOf(o, lang);
  // the three stages in the buyer's words: Payment complete -> Money on hold -> Product confirmed (the last stage, when the seller is paid)
  const paidDone = steps.find((s) => s.key === 'payment')?.state === 'done';
  const label = (k: 'payment' | 'handover' | 'done') => (k === 'payment' ? t(paidDone ? 'order.steps.payment_done' : 'order.steps.payment') : k === 'handover' ? t('order.steps.handover_held') : t('order.steps.done'));
  return (
    <section aria-labelledby="money-title" className={styles.moneyPanel}>
      <h2 id="money-title" className={styles.moneyLabel}>{t('order.counterfoil.stub')}</h2>
      <p className={styles.moneyAmount}>{formatMoney(BigInt(o.total), lang)}</p>
      <p className={styles.money}>{o.status === 'awaiting_payment' && o.role === 'buyer' ? t('order.counterfoil.unpaid') : moneyText(o, t, lang)}</p>
      {out && <p className={styles.hint}>{t('order.money_out_on', { date: out })}</p>}
      {hasReceipt(o) && (
        <button type="button" className={styles.receiptLink} onClick={() => downloadReceipt(o, t, lang, o.counterparty?.displayName || null)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {t('orders.receipt')}
        </button>
      )}
      {steps.length > 0 && (
        <EscrowSteps current={current} label={t('order.steps.label')} labels={[label('payment'), label('handover'), label('done')]}
          stateWords={{ done: t('order.steps.state.done'), current: t('order.steps.state.current'), next: t('order.steps.state.next') }} />
      )}
    </section>
  );
}

/** Section 7.5 (5): the chat with the other party. The buyer may open it; the seller answers once the buyer wrote. */
function OrderChat({ o, t, lang }: { o: OrderView; t: T; lang: Lang }) {
  const { open, busy, error } = useOpenThread();
  const label = t(o.role === 'buyer' ? 'order.message_seller' : 'order.message_buyer');
  if (o.threadId) return <p><Link to={`/messages/${encodeURIComponent(o.threadId)}`}>{label}</Link></p>;
  if (o.role === 'seller') return <p className={styles.hint}>{t('order.chat_none')}</p>;
  return (
    <>
      {error !== null && <FormMessage kind="error">{errorText(error, t, lang)}</FormMessage>}
      <p><button type="button" className={styles.secondary} onClick={() => open(o.listing.id)} disabled={busy} aria-busy={busy}>{label}</button></p>
    </>
  );
}

/** FR-PAY-02: after the provider, only the order's status; the return itself proves nothing. */
function Return({ o, failed, waited, t }: { o: OrderView; failed: boolean; waited: boolean; t: T }) {
  // "held until you have the item" is true only while the order is paid; after it closes the money sentence says where it went
  if (o.status === 'paid') return <FormMessage kind="success">{t('return.paid')}</FormMessage>;
  if (o.status !== 'awaiting_payment') return null;
  if (failed) return <FormMessage kind="error">{t('return.failed')}</FormMessage>;
  if (waited) return <FormMessage kind="info">{t('return.waiting')}</FormMessage>;
  return <p role="status">{t('return.checking')}</p>;
}

function PayPanel({ o, t, lang, onPay }: { o: OrderView; t: T; lang: Lang; onPay: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const now = useServerNow();
  const [message, setMessage] = useState<string | null>(null);
  const due = Date.parse(o.paymentDueAt);
  const over = due <= now;
  // a game account is paid only once the disclosure is acknowledged and the key exists (Unit 5, checkout_ready)
  const game = useGame(o);
  const isGame = o.fulfilment === 'game_account';
  const blockedByGame = isGame && !gameReady(game.data);
  const line = (p: string) => formatMoney(BigInt(p), lang, { decimals: 'always' });

  const choose = useMutation({
    mutationFn: () => api.put(`/orders/${encodeURIComponent(o.id)}/fulfilment`, { fulfilment: 'self_pickup' }) as Promise<OrderView>,
    onSuccess: (next) => queryClient.setQueryData(orderKey(o.id), next),
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const ready = !!o.fulfilment && !over && !blockedByGame;

  const total = formatMoney(BigInt(o.total), lang);
  // one sequence: how you get it, what you pay, pay (the numbers say where the buyer is; the step not yet reached is quiet)
  return (
    <section aria-labelledby="pay-title" className={styles.panel}>
      <h2 id="pay-title">{t('pay.title')}</h2>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <ol className={styles.flow}>
        <li className={o.fulfilment ? styles.flowDone : styles.flowNow}>
          <h3><span className={styles.flowNo} aria-hidden="true">1</span>{t('pay.fulfilment')}</h3>
          {!o.fulfilment ? (
            <div className={styles.optionRows}>
              {o.fulfilmentOptions.includes('self_pickup') && (
                <div className={styles.optionRow}>
                  <div><strong>{t('pay.pickup_title')}</strong><p className={styles.hint}>{t('pay.pickup_note')}</p></div>
                  <button type="button" disabled={choose.isPending || over} onClick={() => choose.mutate()}>{t('pay.self_pickup')}</button>
                </div>
              )}
              {o.fulfilmentOptions.includes('courier') && (
                <div className={styles.optionRow}>
                  <CourierChoice o={o} t={t} lang={lang} disabled={over} />
                </div>
              )}
            </div>
          ) : (
            <p className={styles.chosenRow}>{t(`pay.chosen.${o.fulfilment}`)}</p>
          )}
          {isGame && game.data && <GamePrepare o={o} g={game.data} t={t} lang={lang} disabled={over} />}
          {isGame && game.isError && <FormMessage kind="error">{errorText(game.error, t, lang)}</FormMessage>}
        </li>
        <li className={o.fulfilment ? styles.flowDone : styles.flowNext}>
          <h3><span className={styles.flowNo} aria-hidden="true">2</span>{t('pay.step_total')}</h3>
          <dl className={styles.breakdown}>
            <dt>{t('pay.item')}</dt><dd>{line(o.itemPrice)}</dd>
            <dt>{t('pay.delivery')}</dt><dd>{line(o.deliveryFee)}</dd>
            <dt className={styles.total}>{t('pay.total')}</dt><dd className={styles.total}>{line(o.total)}</dd>
          </dl>
          <p className={styles.hint}>{t('pay.fee_note')}</p>
        </li>
        <li className={ready ? styles.flowNow : styles.flowNext}>
          <h3><span className={styles.flowNo} aria-hidden="true">3</span>{t('pay.step_pay')}</h3>
          <p className={over ? styles.error : styles.hint}>
            {over ? t('pay.window_over') : t('pay.window', { left: formatCountdown(due - now, lang).text, at: formatDateTime(due, lang) })}
          </p>
          <p className={styles.hint}>{t('pay.held_note')}</p>
          {ready ? (
            <button type="button" className={styles.primary} onClick={onPay}>{t('pay.pay', { total })}</button>
          ) : !over && <p className={styles.hint}>{t(blockedByGame ? 'pay.step_game_first' : 'pay.choose_fulfilment')}</p>}
        </li>
      </ol>
    </section>
  );
}
