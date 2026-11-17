// The order view (docs/design/08_frontend.pdf sections 7.4 and 7.5; IF-UI-04, IF-UI-05; FR-PAY-01, FR-PAY-02;
// NFR-USE-07, NFR-USE-08; U8-05, U8-06). One screen for buyer and seller, from top to bottom: where the money is, in
// one sentence; every deadline that applies, as a time and a countdown; what can be done now; the fulfilment (the
// meetup handover or the shipments, Unit 4); the dispute (Unit 7); the chat with the other party; after the order
// closes, the ratings (U8-09). While the order awaits payment the
// buyer chooses how to get the item (self pickup, or courier with a binding quote) and pays here. The provider sends
// the buyer back here (/orders/{id}?payment={attempt}&result=...; Decisions log, U2-03 and U8-05): the page never
// treats that return as payment, and checks the order every 2 s for up to 30 s.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { formatCountdown, formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useOpenThread } from '../../shared/chat';
import { useServerNow } from '../../shared/clock';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { isApiError, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { SimulatedBanner } from '../../shared/SimulatedBanner';
import { Actions } from './Actions';
import { CourierChoice } from './Courier';
import { Deadlines } from './Deadlines';
import { Disputes, useOrderDisputes } from './Disputes';
import { Handover, useHandover } from './Handover';
import { orderKey, type OrderView } from './model';
import { moneyText } from './moneyText';
import { away, PROVIDERS, providerPage, RETURN_POLL_MS, RETURN_WAIT_MS, type Provider } from './payment';
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
  const handover = useHandover(o);
  const shipments = useShipments(o);
  const disputes = useOrderDisputes(o);
  const ratings = useOrderRatings(o);
  const awaiting = o.status === 'awaiting_payment';
  return (
    <div className={styles.page}>
      {(awaiting || attempt) && <SimulatedBanner kind="payment" />}
      <h1>{t('order.title', { title: o.listing.title })}</h1>
      <p>
        <strong>{t(`order.status.${o.status}`)}</strong>
        {' · '}{t(`order.role.${o.role}`)}
        {' · '}<Link to={`/listings/${encodeURIComponent(o.listing.id)}`}>{t('order.listing_link')}</Link>
      </p>
      {attempt && <Return o={o} failed={failed} waited={waited} t={t} />}
      {!(awaiting && o.role === 'buyer') && <p className={styles.money}>{moneyText(o, t, lang)}</p>}
      <Deadlines o={o} h={handover.data ?? null} t={t} lang={lang} />
      {awaiting && o.role === 'buyer' && <PayPanel o={o} t={t} lang={lang} />}
      {o.cancelledAt && o.cancelReason && <p className={styles.hint}>{t('order.cancel_reason', { reason: o.cancelReason })}</p>}
      <Actions o={o} t={t} lang={lang} />
      {disputes.data && <Disputes o={o} items={disputes.data.items} t={t} lang={lang} />}
      {handover.data && <Handover o={o} h={handover.data} t={t} lang={lang} />}
      {handover.isError && <FormMessage kind="error">{errorText(handover.error, t, lang)}</FormMessage>}
      {shipments.data && <Shipments o={o} items={shipments.data.items} t={t} lang={lang} />}
      {shipments.isError && <FormMessage kind="error">{errorText(shipments.error, t, lang)}</FormMessage>}
      {o.fulfilment === 'game_account' && o.status !== 'awaiting_payment' && <p className={styles.hint}>{t('order.game_screens')}</p>}
      <OrderChat o={o} t={t} lang={lang} />
      {ratings.data && <Ratings o={o} r={ratings.data} t={t} lang={lang} />}
    </div>
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
  if (o.status === 'paid' || o.status === 'closed') return <FormMessage kind="success">{t('return.paid')}</FormMessage>;
  if (o.status !== 'awaiting_payment') return null;
  if (failed) return <FormMessage kind="error">{t('return.failed')}</FormMessage>;
  if (waited) return <FormMessage kind="info">{t('return.waiting')}</FormMessage>;
  return <p role="status">{t('return.checking')}</p>;
}

function PayPanel({ o, t, lang }: { o: OrderView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const now = useServerNow();
  const [provider, setProvider] = useState<Provider>('bkash');
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const due = Date.parse(o.paymentDueAt);
  const over = due <= now;
  const line = (p: string) => formatMoney(BigInt(p), lang, { decimals: 'always' });

  const choose = useMutation({
    mutationFn: () => api.put(`/orders/${encodeURIComponent(o.id)}/fulfilment`, { fulfilment: 'self_pickup' }) as Promise<OrderView>,
    onSuccess: (next) => queryClient.setQueryData(orderKey(o.id), next),
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const pay = useMutation({
    mutationFn: () => api.post(`/orders/${encodeURIComponent(o.id)}/payments`, { provider }, { idempotent: true }) as Promise<{ redirectUrl: string }>,
    onSuccess: (r) => {
      setConfirming(false);
      const page = providerPage(r.redirectUrl);
      if (!page) return setMessage(t('pay.bad_redirect'));
      setLeaving(true);
      away.go(page);
    },
    onError: (e) => {
      setConfirming(false);
      const name = problemName(e);
      setMessage(name === 'feature-off' ? t('pay.provider_off') : name === 'provider-unavailable' ? t('pay.provider_unavailable') : errorText(e, t, lang));
      if (name === 'order-state') void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
  });
  // sent once (section 4.2): a second click before the button shows as disabled sends nothing
  const sending = useRef(false);
  const send = () => {
    if (sending.current) return;
    sending.current = true;
    pay.mutate(undefined, { onSettled: () => { sending.current = false; } });
  };

  const total = formatMoney(BigInt(o.total), lang);
  return (
    <section aria-labelledby="pay-title" className={styles.panel}>
      <h2 id="pay-title">{t('pay.title')}</h2>
      <dl className={styles.breakdown}>
        <dt>{t('pay.item')}</dt><dd>{line(o.itemPrice)}</dd>
        <dt>{t('pay.delivery')}</dt><dd>{line(o.deliveryFee)}</dd>
        <dt className={styles.total}>{t('pay.total')}</dt><dd className={styles.total}>{line(o.total)}</dd>
      </dl>
      <p>{t('pay.fee_note')}</p>
      <p>{t('pay.held_note')}</p>
      <p className={over ? styles.error : undefined}>
        {over ? t('pay.window_over') : t('pay.window', { left: formatCountdown(due - now, lang).text, at: formatDateTime(due, lang) })}
      </p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {leaving && <p role="status">{t('pay.leaving')}</p>}
      {!o.fulfilment && (
        <fieldset className={styles.choice}>
          <legend>{t('pay.fulfilment')}</legend>
          <p>{t('pay.choose_fulfilment')}</p>
          {o.listing.itemKind === 'game_account' && !o.fulfilmentOptions.includes('game_account') && <FormMessage kind="info">{t('pay.game_not_yet')}</FormMessage>}
          {o.fulfilmentOptions.includes('self_pickup') && (
            <button type="button" disabled={choose.isPending || over} onClick={() => choose.mutate()}>
              {t('pay.self_pickup')}
            </button>
          )}
          {o.fulfilmentOptions.includes('courier') && <CourierChoice o={o} t={t} lang={lang} disabled={over} />}
        </fieldset>
      )}
      {o.fulfilment && (
        <p>{t(`pay.chosen.${o.fulfilment}`)}</p>
      )}
      {o.fulfilment && !over && (
        <>
          <fieldset className={styles.choice}>
            <legend>{t('pay.method')}</legend>
            {PROVIDERS.map((p) => (
              <div key={p}>
                <input id={`pay-${p}`} type="radio" name="provider" value={p} checked={provider === p} onChange={() => setProvider(p)} />
                <label htmlFor={`pay-${p}`}>{t(`pay.method.${p}`)}</label>
              </div>
            ))}
          </fieldset>
          <button type="button" className={styles.primary} disabled={pay.isPending || leaving} onClick={() => setConfirming(true)}>{t('pay.pay', { total })}</button>
        </>
      )}
      {confirming && (
        <ConfirmDialog id="pay-confirm" title={t('pay.confirm_title')} busy={pay.isPending}
          confirmLabel={t('pay.confirm_button', { total })} cancelLabel={t('pay.cancel')} onConfirm={send} onCancel={() => setConfirming(false)}>
          <p>{t('confirm.buy_now', { amount: total, item: line(o.itemPrice), delivery: line(o.deliveryFee) })}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
