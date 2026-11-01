// Checkout of a fixed-price item (docs/design/08_frontend.pdf section 7.4; IF-UI-04; FR-FIX-01, FR-FIX-05; U8-05).
// The buyer chooses the quantity and how they get the item; "Continue to payment" calls POST /orders with an
// Idempotency-Key, which reserves the units (Unit 2), and the order page takes the payment, the same as for an
// auction win. Until Unit 4 issues delivery quotes only self pickup can be chosen, and game accounts wait for the
// disclosure and the browser check of U8-07 (Decisions log, U8-05). A guest is sent to sign in.
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
import { FRESHNESS } from '../../shared/query';
import { SimulatedBanner } from '../../shared/SimulatedBanner';
import en from '../../messages/en/checkout.json';
import bn from '../../messages/bn/checkout.json';
import styles from './checkout.module.css';

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
}

export function Component() {
  const { listingId = '' } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);

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
    mutationFn: (q: number) => api.post('/orders', { listingId, quantity: q, fulfilment: 'self_pickup' }, { idempotent: true }) as Promise<{ id: string }>,
    onSuccess: (o) => void navigate(`/orders/${encodeURIComponent(o.id)}`),
    onError: (e) => {
      const name = problemName(e);
      setError(name === 'not-available' ? t('checkout.unavailable')
        : name === 'order-limit' ? t('checkout.limit')
        : name === 'transaction-not-allowed' ? t('checkout.verify')
        : name === 'feature-off' ? t('checkout.not_active')
        : isApiError(e, 403) ? t('checkout.own')
        : errorText(e, t, lang));
      void listing.refetch();
    },
  });
  // sent once (section 4.2)
  const sending = useRef(false);

  if (me.isPending || me.isError || listing.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (listing.isError) return <FormMessage kind="error">{errorText(listing.error, t, lang)}</FormMessage>;
  const l = listing.data;
  const own = me.data.id === l.seller.id;
  const blocked = own ? t('checkout.own')
    : l.saleFormat !== 'fixed_price' || l.status !== 'active' || !l.price ? t('checkout.not_active')
    : l.itemKind === 'game_account' ? t('checkout.game_not_yet')
    : l.fulfilmentOptions === 'courier_only' ? t('checkout.courier_not_yet')
    : l.quantity.available < 1 ? t('checkout.unavailable')
    : null;
  const max = l.quantity.available;
  const n = Number(toAsciiDigits(quantity).trim());
  const valid = Number.isInteger(n) && n >= 1 && n <= max;
  const total = l.price && valid ? formatMoney(BigInt(l.price) * BigInt(n), lang) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return setError(t('checkout.quantity_invalid', { max: toLocalDigits(String(max), lang) }));
    if (sending.current) return;
    sending.current = true;
    setError(null);
    create.mutate(n, { onSettled: () => { sending.current = false; } });
  };

  return (
    <div className={styles.page}>
      <SimulatedBanner kind="payment" />
      <h1>{t('checkout.title')}</h1>
      <section aria-labelledby="item-title" className={styles.item}>
        <h2 id="item-title">{t('checkout.item')}</h2>
        <p><Link to={`/listings/${encodeURIComponent(l.id)}`}>{l.title}</Link></p>
        {l.price && <p>{t('checkout.unit_price', { price: formatMoney(BigInt(l.price), lang) })}</p>}
      </section>
      {blocked
        ? <FormMessage kind="info">{blocked}</FormMessage>
        : (
          <form onSubmit={submit} noValidate className={styles.form}>
            {error && <FormMessage kind="error">{error}</FormMessage>}
            {l.quantity.total > 1 && (
              <div className={styles.field}>
                <label htmlFor="checkout-quantity">{t('checkout.quantity')}</label>
                <input id="checkout-quantity" type="text" inputMode="numeric" value={quantity} maxLength={4}
                  aria-describedby="checkout-available" onChange={(e) => setQuantity(e.target.value)} />
                <p id="checkout-available" className={styles.hint}>{t('checkout.available', { count: toLocalDigits(String(max), lang) })}</p>
              </div>
            )}
            <fieldset className={styles.field}>
              <legend>{t('checkout.fulfilment')}</legend>
              <div className={styles.option}>
                <input id="checkout-pickup" type="radio" name="fulfilment" value="self_pickup" checked readOnly />
                <label htmlFor="checkout-pickup">{t('checkout.fulfilment.self_pickup')}</label>
              </div>
              {l.fulfilmentOptions === 'pickup_or_courier' && <p className={styles.hint}>{t('checkout.courier_also')}</p>}
            </fieldset>
            {total && <p className={styles.total}>{t('checkout.total', { total })}</p>}
            <p className={styles.hint}>{t('checkout.reserve_note')}</p>
            <button type="submit" className={styles.primary} disabled={create.isPending}>{t('checkout.continue')}</button>
          </form>
        )}
    </div>
  );
}
