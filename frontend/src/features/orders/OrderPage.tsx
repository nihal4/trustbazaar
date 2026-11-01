// The order page, first part (docs/design/08_frontend.pdf section 7.4; IF-UI-04; FR-PAY-01, FR-PAY-02; U8-05).
// The provider sends the buyer back here (/orders/{id}?payment={attempt}&result=...; Decisions log, U2-03 and
// U8-05). The page never treats that return as payment: it shows the order's status, checking every 2 s for up
// to 30 s, then says it is still waiting. While the order awaits payment the buyer pays here, the same for a
// fixed-price checkout and an auction win. The full order view (tabs, deadlines, actions) is U8-06.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { describeMoney } from '../../lib/moneyState.js';
import { formatCountdown, formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
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
import { away, PROVIDERS, providerPage, RETURN_POLL_MS, RETURN_WAIT_MS, type Provider } from './payment';
import en from '../../messages/en/orders.json';
import bn from '../../messages/bn/orders.json';
import styles from './orders.module.css';

const CATALOGUES = { en, bn };

/** The fields of GET /orders/{id} (Unit 2 section 3.1) that this page reads. Money in poisha, as strings. */
export interface OrderView {
  id: string;
  kind: 'fixed_price' | 'auction' | 'second_chance';
  role: 'buyer' | 'seller';
  status: 'awaiting_payment' | 'paid' | 'cancelled' | 'closed';
  listing: { id: string; title: string; itemKind: 'physical' | 'game_account'; photoKey: string | null };
  quantity: number;
  itemPrice: string;
  deliveryFee: string;
  total: string;
  fulfilment: 'self_pickup' | 'courier' | 'game_account' | null;
  fulfilmentOptions: ('self_pickup' | 'courier' | 'game_account')[];
  paymentDueAt: string;
  paidAt: string | null;
  fulfilmentDueAt: string | null;
  deliveryEventAt: string | null;
  closedAt: string | null;
  escrow: null | { state: 'held' | 'frozen_disputed' | 'released' | 'refunded' | 'partially_refunded'; releasePolicy: 'standard' | 'game_protection'; amountCollected: string; amountRefunded: string; autoReleaseAt: string | null };
}

export const orderKey = (id: string) => ['orders', id] as const;

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
  const o = order.data;
  const awaiting = o.status === 'awaiting_payment';
  return (
    <div className={styles.page}>
      {(awaiting || attempt) && <SimulatedBanner kind="payment" />}
      <h1>{t('order.title', { title: o.listing.title })}</h1>
      <p>
        <strong>{t(`order.status.${o.status}`)}</strong>
        {' · '}<Link to={`/listings/${encodeURIComponent(o.listing.id)}`}>{t('order.listing_link')}</Link>
      </p>
      {attempt && <Return o={o} failed={failed} waited={waited} t={t} />}
      {!awaiting && <p className={styles.money}>{moneyText(o, t, lang)}</p>}
      {awaiting && o.role === 'buyer' && <PayPanel o={o} t={t} lang={lang} />}
      {awaiting && o.role === 'seller' && <p className={styles.money}>{moneyText(o, t, lang)}</p>}
    </div>
  );
}

/** NFR-USE-07: where the money is, in one sentence (lib/moneyState.js and the reference catalogue). */
function moneyText(o: OrderView, t: T, lang: Lang): string {
  const ms = (s: string | null) => (s ? Date.parse(s) : null);
  const d = describeMoney({
    status: o.status, escrowState: o.escrow?.state ?? null, releasePolicy: o.escrow?.releasePolicy ?? 'standard',
    total: Number(o.total), refunded: Number(o.escrow?.amountRefunded ?? 0), paymentDueAt: ms(o.paymentDueAt) ?? 0,
    fulfilmentDueAt: ms(o.fulfilmentDueAt) ?? 0, deliveryEventAt: ms(o.deliveryEventAt), autoReleaseAt: ms(o.escrow?.autoReleaseAt ?? null), closedAt: ms(o.closedAt),
  }, o.role);
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.vars)) vars[k] = 'money' in v ? formatMoney(BigInt(v.money), lang) : formatDateTime(v.time, lang);
  return t(d.key, vars);
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
          {!o.fulfilmentOptions.includes('self_pickup') && (
            <FormMessage kind="info">{o.listing.itemKind === 'game_account' ? t('pay.game_not_yet') : t('pay.courier_not_yet')}</FormMessage>
          )}
          <button type="button" disabled={choose.isPending || over || !o.fulfilmentOptions.includes('self_pickup')} onClick={() => choose.mutate()}>
            {t('pay.self_pickup')}
          </button>
        </fieldset>
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
