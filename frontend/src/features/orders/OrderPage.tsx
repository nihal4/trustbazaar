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
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { ChatIcon, Tick } from '../../shared/icons';
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
import { DisputeSlot, useOrderDisputes } from './Disputes';
import { GamePrepare, gameReady, GameTab, useGame } from './Game';
import { Handover, ProposeForm, useHandover } from './Handover';
import { Breakdown } from './Summary';
import { orderKey, type OrderView } from './model';
import { moneyLine } from './moneyText';
import { RETURN_POLL_MS, RETURN_WAIT_MS } from './payment';
import { downloadReceipt, hasReceipt } from './receipt';
import { Popup } from '../../shared/Popup';
import { PaymentSheet } from '../../shared/PaymentSheet';
import { Ratings, useOrderRatings } from './Ratings';
import { ShipmentHistory, Shipments, useShipments } from './Shipments';
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
  if (order.isError && !order.data) {
    if (isApiError(order.error, 401)) {
      return <p><Link to={signInPath(`/orders/${id}`)}>{t('order.sign_in')}</Link></p>;
    }
    return isApiError(order.error, 404) ? <h1>{t('order.not_found')}</h1> : <FormMessage kind="error">{errorText(order.error, t, lang)}</FormMessage>;
  }
  return <OrderBody o={order.data!} attempt={attempt} failed={failed} waited={waited} t={t} lang={lang} />;
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
  // while a meetup is being arranged, its place-and-time and cancel actions sit inside the Meetup handover block, above the code
  const handoverOpen = handover.data !== undefined && (handover.data.status === 'arranging' || handover.data.status === 'agreed');
  return (
    <div className={styles.page}>
      {(awaiting || attempt) && <SimulatedBanner kind="payment" />}
      <div className={styles.cols}>
      <div className={styles.main}>
      <header className={styles.head}>
        <span className={styles.thumb}>
          {o.listing.photoKey && <img src={`/api/v1/listing-photos/${encodeURIComponent(o.listing.photoKey)}?size=thumb`} alt="" width={88} height={88} />}
        </span>
        <div className={styles.headText}>
          <h1>{t('order.title', { title: o.listing.title })}</h1>
        </div>
        <dl className={styles.facts}>
          <div><dt>{t('order.fact.status')}</dt><dd className={styles.status}>{t(`order.status.${o.status}`)}</dd></div>
          <div><dt>{t('order.fact.role')}</dt><dd>{t(`order.role.${o.role}`)}</dd></div>
          <div><dt>{t('order.fact.listing')}</dt><dd><Link to={`/listings/${encodeURIComponent(o.listing.id)}`}>{t('order.listing_link')}</Link></dd></div>
        </dl>
      </header>
      <Money o={o} t={t} lang={lang} />
      <div className={styles.early}>
      {attempt && <Return o={o} failed={failed} waited={waited} t={t} />}
      <Breakdown o={o} t={t} lang={lang} />
      {sheet && (
        <PaymentSheet order={{ id: o.id, total: o.total, key: orderKey(o.id) }} t={t} lang={lang} onReceipt={(p) => { const paid = p as OrderView; downloadReceipt(paid, t, lang, paid.counterparty?.displayName || null); }} onClose={() => setSheet(false)}
          onPaid={() => { setSheet(false); void queryClient.invalidateQueries({ queryKey: orderKey(o.id) }); }} />
      )}
      {o.cancelledAt && o.cancelReason && CANCEL_REASONS.includes(o.cancelReason) && <p className={styles.hint}>{t(`order.cancel_reason.${o.cancelReason}`)}</p>}
      </div>
      {shipments.isError && <FormMessage kind="error">{errorText(shipments.error, t, lang)}</FormMessage>}
      {game.data && o.status !== 'awaiting_payment' && <GameTab o={o} g={game.data} t={t} lang={lang} />}
      {game.isError && o.status !== 'awaiting_payment' && <FormMessage kind="error">{errorText(game.error, t, lang)}</FormMessage>}
      {ratings.data && <Ratings o={o} r={ratings.data} t={t} lang={lang} />}
      </div>
      <aside className={styles.rail} aria-label={t('order.next.label')}>
      {/* the same slots in every state: 1 how it gets to the buyer (pay, meetup or courier), 2 deadlines, 3 shipment history, 4 what can be done, 5 dispute, 6 the other party */}
      {awaiting && o.role === 'buyer' && <PayPanel o={o} t={t} lang={lang} onPay={() => setSheet(true)} />}
      {handover.data && <Handover o={o} h={handover.data} t={t} lang={lang} />}
      {handover.isError && <FormMessage kind="error">{errorText(handover.error, t, lang)}</FormMessage>}
      {shipments.data && o.fulfilment === 'courier' && <Shipments o={o} items={shipments.data.items} t={t} lang={lang} />}
      {!handover.isLoading && <Deadlines o={o} h={handover.data ?? null} t={t} lang={lang} />}
      {shipments.data && <ShipmentHistory items={shipments.data.items} t={t} lang={lang} />}
      {!handover.isLoading && <Actions o={o} t={t} lang={lang} extra={handoverOpen && handover.data ? <ProposeForm o={o} h={handover.data} t={t} lang={lang} /> : undefined} />}
      {disputes.data && <DisputeSlot o={o} items={disputes.data.items} t={t} lang={lang} />}
      <PartyCard o={o} t={t} lang={lang} />
      </aside>
      </div>
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
      <p className={styles.money}>{o.status === 'awaiting_payment' && o.role === 'buyer' ? t('order.counterfoil.unpaid') : moneyLine(o, t, lang)}</p>
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

/** The other party in the rail, as the seller row of the listing page: the badge, the name with the verified mark, since when, and a chat cell. */
function PartyCard({ o, t, lang }: { o: OrderView; t: T; lang: Lang }) {
  const c = o.counterparty;
  if (!c?.displayName) return null;
  const which = o.role === 'buyer' ? 'seller' : 'buyer';
  const initials = c.displayName.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] ?? '').join('').toUpperCase();
  return (
    <section aria-labelledby="party-title" className={styles.party}>
      <h2 id="party-title" className={styles.partyHead}>{t(`order.party.${which}`)}</h2>
      <div className={styles.partyRow}>
        <span className={styles.avatar} aria-hidden="true">{initials}</span>
        <div className={styles.partyInfo}>
          <p className={styles.partyLine}>
            <strong>{c.displayName}</strong>
            {c.verified === true && <span className={styles.tick} title={t('order.party.verified')}><Tick /><span className={styles.srOnly}>{t('order.party.verified')}</span></span>}
          </p>
          {c.joinMonth && <p className={styles.partySince}>{t('order.party.since', { year: toLocalDigits(c.joinMonth.slice(0, 4), lang) })}</p>}
        </div>
        <OrderChat o={o} t={t} lang={lang} />
      </div>
    </section>
  );
}

/** Section 7.5 (5): the chat with the other party. The buyer may open it; the seller answers once the buyer wrote. */
function OrderChat({ o, t, lang }: { o: OrderView; t: T; lang: Lang }) {
  const { open, busy, error } = useOpenThread();
  const label = t(o.role === 'buyer' ? 'order.message_seller' : 'order.message_buyer');
  if (o.threadId) return <Link className={styles.chatCell} to={`/messages/${encodeURIComponent(o.threadId)}`} aria-label={label} title={label}><ChatIcon /><span className={styles.chatLabel}>{t('order.chat.short')}</span></Link>;
  if (o.role === 'seller') return null;
  return (
    <>
      <button type="button" className={styles.chatCell} onClick={() => open(o.listing.id)} disabled={busy} aria-busy={busy} aria-label={label} title={label}><ChatIcon /><span className={styles.chatLabel}>{t('order.chat.short')}</span></button>
      {error !== null && <div className={styles.chatError}><FormMessage kind="error">{errorText(error, t, lang)}</FormMessage></div>}
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
  const [changing, setChanging] = useState(false);
  const [courier, setCourier] = useState(false);
  const over = Date.parse(o.paymentDueAt) <= now;
  // a game account is paid only once the disclosure is acknowledged and the key exists (Unit 5, checkout_ready)
  const game = useGame(o);
  const isGame = o.fulfilment === 'game_account';
  const blockedByGame = isGame && !gameReady(game.data);
  const meet = useMutation({
    mutationFn: () => api.put(`/orders/${encodeURIComponent(o.id)}/fulfilment`, { fulfilment: 'self_pickup' }) as Promise<OrderView>,
    onSuccess: (next) => { queryClient.setQueryData(orderKey(o.id), next); setChanging(false); },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const ready = !!o.fulfilment && !over && !blockedByGame;
  const choosing = !o.fulfilment || changing;
  const total = formatMoney(BigInt(o.total), lang);
  // one step: how do you want it? Meeting the seller is chosen at once; courier asks for the address and the fee in a popup
  return (
    <section aria-labelledby="pay-title" className={`${styles.panel} ${styles.early}`}>
      <h2 id="pay-title">{t('pay.title')}</h2>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {choosing && !isGame ? (
        <div className={styles.choiceGrid} role="group" aria-label={t('pay.fulfilment')}>
          {o.fulfilmentOptions.includes('self_pickup') && (
            <button type="button" className={styles.choiceCell} disabled={meet.isPending || over} onClick={() => meet.mutate()}>
              <strong>{t('pay.opt.meet')}</strong><span>{t('pay.opt.meet.note')}</span>
            </button>
          )}
          {o.fulfilmentOptions.includes('courier') && (
            <button type="button" className={styles.choiceCell} disabled={over} onClick={() => setCourier(true)}>
              <strong>{t('pay.opt.courier')}</strong><span>{t('pay.opt.courier.note')}</span>
            </button>
          )}
        </div>
      ) : (
        <div className={styles.chosenGrid}>
          <dl><div><dt>{t('pay.delivery')}</dt><dd>{t(`pay.chosen.${o.fulfilment}`)}</dd></div></dl>
          {!isGame && <button type="button" className={styles.changeCell} disabled={over} onClick={() => setChanging(true)}>{t('pay.change')}</button>}
        </div>
      )}
      {courier && (
        <Popup id="courier-popup" title={t('courier.title')} closeLabel={t('actions.back')} onClose={() => setCourier(false)}>
          <CourierChoice o={o} t={t} lang={lang} disabled={over} onDone={() => { setCourier(false); setChanging(false); }} />
        </Popup>
      )}
      {isGame && game.data && <GamePrepare o={o} g={game.data} t={t} lang={lang} disabled={over} />}
      {isGame && game.isError && <FormMessage kind="error">{errorText(game.error, t, lang)}</FormMessage>}
      {!over && !ready && <p id="pay-why" className={styles.hint}>{t(blockedByGame ? 'pay.step_game_first' : 'pay.choose_fulfilment')}</p>}
      {over ? <p className={styles.error}>{t('pay.window_over')}</p> : (
        <div className={styles.payRow}>
          <div><span>{t('pay.total')}</span><strong>{total}</strong></div>
          {ready
            ? <button type="button" className={styles.primary} onClick={onPay}>{t('pay.pay', { total })}</button>
            : <button type="button" className={styles.primary} disabled aria-describedby="pay-why">{t('pay.pay', { total })}</button>}
        </div>
      )}
    </section>
  );
}
