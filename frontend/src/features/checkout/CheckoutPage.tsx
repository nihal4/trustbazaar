// Checkout of a fixed-price item (docs/design/08_frontend.pdf section 7.4; IF-UI-04; FR-FIX-01, FR-FIX-05; U8-05).
// The buyer chooses the quantity and how they get the item; "Continue to payment" calls POST /orders with an
// Idempotency-Key, which reserves the units (Unit 2), and the order page takes the payment, the same as for an
// auction win. Courier delivery (U8-06) is chosen here and completed on the order page, where the buyer gives the
// address and gets the binding quote (Unit 4, DV-23) before paying. A game account first needs a browser with Web
// Crypto and IndexedDB (Unit 5, AS-5) and is told to stay in this browser; its disclosure and key come on the order
// page before payment (U8-07). A guest is sent to sign in. Money-order world (docs/design/10_visual_v2.md, AC-ORD-1):
// the item and the choices on the left; on the right the summary as the counterfoil, whose stub says the total and
// whose form carries the amount in figures and in words, how the money moves and the button; one column on phones.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { formatMoney, toAsciiDigits, toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import { useMe } from '../../shared/me';
import { isApiError, problemName } from '../../shared/problems';
import { moneySteps } from '../../shared/moneySteps';
import { FRESHNESS } from '../../shared/query';
import { PaymentSheet } from '../../shared/PaymentSheet';
import enOrders from '../../messages/en/orders.json';
import bnOrders from '../../messages/bn/orders.json';
import { SimulatedBanner } from '../../shared/SimulatedBanner';
import en from '../../messages/en/checkout.json';
import bn from '../../messages/bn/checkout.json';
import styles from './checkout.module.css';
import { Button, Stepper } from '../../shared/ui';

const CATALOGUES = { en, bn };

/** The fields of GET /listings/{id} that checkout reads. */
interface Listing {
  id: string;
  itemKind: 'physical' | 'game_account';
  saleFormat: 'fixed_price' | 'auction';
  status: string;
  title: string;
  price: string | null;
  fulfilmentOptions: 'pickup_only' | 'courier_only' | 'pickup_or_courier' | null;
  quantity: { total: number; available: number };
  seller: { id: string };
  photos?: { thumbUrl: string }[];
}

/** Unit 5, AS-5: a game account needs a browser that keeps a non-extractable key (Web Crypto) in IndexedDB. */
function browserKeepsKeys(): boolean {
  return typeof globalThis.crypto?.subtle?.generateKey === 'function' && typeof globalThis.indexedDB?.open === 'function';
}

export function Component() {
  const { listingId = '' } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [method, setMethod] = useState<'self_pickup' | 'courier' | null>(null);
  const [paying, setPaying] = useState<string | null>(null);

  // a guest is sent to sign in, returning here (section 3.3)
  useEffect(() => {
    if (me.isError) void navigate(signInPath(`/checkout/${listingId}`), { replace: true });
  }, [me.isError, navigate, listingId]);

  const listing = useQuery({
    queryKey: ['listings', listingId],
    queryFn: ({ signal }) => api.get(`/listings/${encodeURIComponent(listingId)}`, { signal }) as Promise<Listing>,
    staleTime: FRESHNESS.search,
    retry: false,
    enabled: me.isSuccess,
  });
  const create = useMutation({
    // courier is chosen on the order page with its quote; the order is created without a method (Unit 2, FR-DLV-02)
    mutationFn: ({ q, f }: { q: number; f: 'self_pickup' | 'courier' | 'game_account' }) =>
      api.post('/orders', { listingId, quantity: q, ...(f === 'self_pickup' ? { fulfilment: 'self_pickup' } : {}) }, { idempotent: true }) as Promise<{
        id: string;
      }>,
    // paying: a pickup order is paid right here, in the payment sheet; courier needs the address and quote on the order page, a game account its key
    onSuccess: (o, v) => (v.f === 'self_pickup' ? setPaying(o.id) : void navigate(`/orders/${encodeURIComponent(o.id)}`)),
    onError: (e) => {
      const name = problemName(e);
      setError(
        name === 'not-available'
          ? t('checkout.unavailable')
          : name === 'order-limit'
            ? t('checkout.limit')
            : name === 'transaction-not-allowed'
              ? t('checkout.verify')
              : name === 'feature-off'
                ? t('checkout.not_active')
                : isApiError(e, 403)
                  ? t('checkout.own')
                  : errorText(e, t, lang),
      );
      void listing.refetch();
    },
  });
  // sent once (section 4.2)
  const sending = useRef(false);

  if (me.isPending || me.isError || listing.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (listing.isError) return <FormMessage kind="error">{errorText(listing.error, t, lang)}</FormMessage>;
  const l = listing.data;
  const own = me.data.id === l.seller.id;
  const blocked = own
    ? t('checkout.own')
    : l.saleFormat !== 'fixed_price' || l.status !== 'active' || !l.price
      ? t('checkout.not_active')
      : l.itemKind === 'game_account' && !browserKeepsKeys()
        ? t('checkout.game_browser')
        : l.quantity.available < 1
          ? t('checkout.unavailable')
          : null;
  const max = l.quantity.available;
  const n = Number(toAsciiDigits(quantity).trim());
  const valid = Number.isInteger(n) && n >= 1 && n <= max;
  const sum = l.price && valid ? BigInt(l.price) * BigInt(n) : null;
  const total = sum === null ? null : formatMoney(sum, lang);
  const pickup = l.fulfilmentOptions !== 'courier_only';
  const courier = l.fulfilmentOptions === 'courier_only' || l.fulfilmentOptions === 'pickup_or_courier';
  const game = l.itemKind === 'game_account';
  const chosen: 'self_pickup' | 'courier' | 'game_account' = game ? 'game_account' : (method ?? (pickup ? 'self_pickup' : 'courier'));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return setError(t('checkout.quantity_invalid', { max: toLocalDigits(String(max), lang) }));
    if (sending.current) return;
    sending.current = true;
    setError(null);
    create.mutate(
      { q: n, f: chosen },
      {
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  };

  const thumb = l.photos?.[0]?.thumbUrl;
  return (
    <div className={styles.page}>
      <SimulatedBanner kind="payment" />
      <h1 className={styles.title}>{t('checkout.title')}</h1>
      <div className={styles.layout}>
        <div className={styles.main}>
          <section aria-labelledby="item-title" className={styles.item}>
            <h2 id="item-title" className={styles.visuallyHidden}>
              {t('checkout.item')}
            </h2>
            <span className={styles.thumb}>{thumb && <img src={thumb} alt="" width={96} height={96} />}</span>
            <div>
              <p className={styles.itemTitle}>
                <Link to={`/listings/${encodeURIComponent(l.id)}`}>{l.title}</Link>
              </p>
              {l.price && <p className={styles.hint}>{t('checkout.unit_price', { price: formatMoney(BigInt(l.price), lang) })}</p>}
            </div>
          </section>
          {blocked ? (
            <FormMessage kind="info">{blocked}</FormMessage>
          ) : (
            <form id="checkout-form" onSubmit={submit} noValidate className={styles.form}>
              {error && <FormMessage kind="error">{error}</FormMessage>}
              {l.quantity.total > 1 && (
                <div className={styles.field}>
                  <label htmlFor="checkout-quantity">{t('checkout.quantity')}</label>
                  <input
                    id="checkout-quantity"
                    type="text"
                    inputMode="numeric"
                    value={quantity}
                    maxLength={4}
                    aria-describedby="checkout-available"
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                  <p id="checkout-available" className={styles.hint}>
                    {t('checkout.available', { count: toLocalDigits(String(max), lang) })}
                  </p>
                </div>
              )}
              {game ? (
                <div className={styles.gameNote}>
                  <p>
                    <strong>{t('checkout.game_title')}</strong>
                  </p>
                  <p>{t('checkout.game_same_browser')}</p>
                  <p className={styles.hint}>{t('checkout.game_next')}</p>
                </div>
              ) : (
                <fieldset className={styles.field}>
                  <legend>{t('checkout.fulfilment')}</legend>
                  {pickup && (
                    <div className={styles.option}>
                      <input
                        id="checkout-pickup"
                        type="radio"
                        name="fulfilment"
                        value="self_pickup"
                        checked={chosen === 'self_pickup'}
                        onChange={() => setMethod('self_pickup')}
                      />
                      <label htmlFor="checkout-pickup">{t('checkout.fulfilment.self_pickup')}</label>
                    </div>
                  )}
                  {courier && (
                    <div className={styles.option}>
                      <input
                        id="checkout-courier"
                        type="radio"
                        name="fulfilment"
                        value="courier"
                        checked={chosen === 'courier'}
                        onChange={() => setMethod('courier')}
                      />
                      <label htmlFor="checkout-courier">{t('checkout.fulfilment.courier')}</label>
                    </div>
                  )}
                  {chosen === 'courier' && <p className={styles.hint}>{t('checkout.courier_note')}</p>}
                </fieldset>
              )}
            </form>
          )}
        </div>
        {!blocked && (
          <aside className={styles.summary} aria-labelledby="summary-title">
            <h2 id="summary-title" className={styles.summaryLabel}>
              {t('checkout.summary')}
            </h2>
            {total && <p className={styles.summaryAmount}>{total}</p>}
            {total && chosen === 'courier' && <p className={styles.hint}>{t('checkout.total_plus_delivery', { total })}</p>}
            <p>
              <strong>{t('checkout.promise.title')}</strong>
            </p>
            <div className={styles.steps}>
              <Stepper
                look="line"
                steps={moneySteps([t('checkout.counterfoil.in'), t('checkout.counterfoil.held'), t('checkout.counterfoil.out')], null)}
                label={t('checkout.steps_label')}
              />
            </div>
            <Button variant="primary" type="submit" form="checkout-form" disabled={create.isPending}>
              {t('checkout.continue')}
            </Button>
            <p className={styles.hint}>{t('checkout.reserve_note')}</p>
          </aside>
        )}
      </div>
      {paying && <PayHost id={paying} onDone={() => void navigate(`/orders/${encodeURIComponent(paying)}`)} />}
    </div>
  );
}

/** The payment sheet over the checkout, once the order exists: its total comes from the order itself. Closing it without paying, or paying, goes on to the order's page. */
function PayHost({ id, onDone }: { id: string; onDone: () => void }) {
  const { t, lang } = useT({ en: enOrders, bn: bnOrders });
  const api = useApi();
  const key = ['orders', id] as const; // the order page's own key, so the paid order is already there when it opens
  const order = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(id)}`, { signal }) as Promise<{ id: string; total: string }>,
    staleTime: 0,
    retry: false,
  });
  useEffect(() => {
    if (order.isError) onDone();
  }, [order.isError, onDone]);
  if (!order.data)
    return (
      <p role="status" className={styles.visuallyHidden}>
        {t('shell.loading')}
      </p>
    );
  return <PaymentSheet order={{ id: order.data.id, total: order.data.total, key }} t={t} lang={lang} onClose={onDone} onPaid={onDone} />;
}
