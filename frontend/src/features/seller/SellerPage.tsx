// The seller dashboard, /seller (docs/design/08_frontend.pdf section 7.8; IF-UI-08; FR-PAY-17, FR-PAY-21; U8-09):
// orders needing action with their deadlines first, listings by state, the payout account and its check status,
// payouts and statements. Every figure comes from the server; the dashboard computes nothing about money.
import { useState } from 'react';
import { Button } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { formatDateTime, formatDeadline } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { SimulatedBanner } from '../../shared/SimulatedBanner';
import { accountLine, accountStatus, needingAction, type PayoutAccount, type SellerOrder } from './model';
import en from '../../messages/en/seller.json';
import bn from '../../messages/bn/seller.json';
import styles from './seller.module.css';

const CATALOGUES = { en, bn };
const LISTING_STATES = ['active', 'pending_review', 'draft', 'sold', 'ended_unsold', 'cancelled', 'removed'] as const;
type ListingState = (typeof LISTING_STATES)[number];

interface MyListing {
  id: string; title: string; status: ListingState; saleFormat: 'fixed_price' | 'auction'; price: string | null;
  quantity: { total: number; available: number }; createdAt: string; publishedAt: string | null;
}
interface PayoutRow { id: string; orderId: string; amount: string; status: string; simulated: boolean; createdAt: string; sentAt: string | null }
interface Statement {
  orderId: string; title: string | null; settledAt: string; amountCollected: string; itemPrice: string; deliveryFee: string; commission: string;
  courierPayout: string; sellerPayout: string; refundTotal: string; payout: { id: string; amount: string; status: string; simulated: boolean } | null;
}

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const orders = useQuery({
    queryKey: ['orders', { role: 'seller' }, 'first'],
    queryFn: ({ signal }) => api.get('/orders?role=seller', { signal }) as Promise<{ items: SellerOrder[]; nextCursor: string | null }>,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  if (orders.isError && isApiError(orders.error, 401)) return <p><Link to={signInPath('/seller')}>{t('seller.sign_in')}</Link></p>;
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{t('seller.title')}</h1>
        <Button component={Link} to="/sell/new">{t('seller.new_listing')}</Button>
      </div>
      <ActionNeeded orders={orders.data?.items ?? null} error={orders.error} t={t} lang={lang} />
      <Listings t={t} lang={lang} />
      <Payouts t={t} lang={lang} />
      <Statements t={t} lang={lang} />
    </div>
  );
}

function ActionNeeded({ orders, error, t, lang }: { orders: SellerOrder[] | null; error: unknown; t: T; lang: Lang }) {
  const now = useServerNow();
  const list = orders ? needingAction(orders) : [];
  return (
    <section aria-labelledby="action-title" className={styles.panel}>
      <h2 id="action-title">{t('seller.action_title')}</h2>
      {error !== null && error !== undefined && <FormMessage kind="error">{errorText(error, t, lang)}</FormMessage>}
      {orders === null && error == null && <p role="status">{t('shell.loading')}</p>}
      {orders && list.length === 0 && <p className={styles.hint}>{t('seller.action_none')}</p>}
      <ul className={styles.list}>
        {list.map(({ order: o, why, due }) => (
          <li key={o.id} className={styles.row}>
            <Link to={`/orders/${encodeURIComponent(o.id)}`}><strong>{o.listing.title}</strong></Link>
            <p>{t(`seller.why.${why}`)}{due !== null ? ` · ${formatDeadline(due, now, lang)}` : ''}</p>
          </li>
        ))}
      </ul>
      <p><Link to="/orders?role=seller">{t('seller.all_sales')}</Link></p>
    </section>
  );
}

function Listings({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const [state, setState] = useState<ListingState>('active');
  const listings = useInfiniteQuery({
    queryKey: ['me', 'listings', state],
    queryFn: ({ pageParam, signal }) =>
      api.get(`/me/listings?status=${state}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }) as Promise<{ items: MyListing[]; nextCursor: string | null }>,
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.search,
    retry: false,
  });
  const items = listings.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section aria-labelledby="listings-title" className={styles.panel}>
      <h2 id="listings-title">{t('seller.listings_title')}</h2>
      <label htmlFor="listing-state">{t('seller.listing_state')}</label>
      <select id="listing-state" value={state} onChange={(e) => setState(e.target.value as ListingState)} className={styles.select}>
        {LISTING_STATES.map((s) => <option key={s} value={s}>{t(`seller.state.${s}`)}</option>)}
      </select>
      {listings.isPending && <p role="status">{t('shell.loading')}</p>}
      {listings.isError && <FormMessage kind="error">{listingsError(listings.error, t, lang)}</FormMessage>}
      {listings.isSuccess && items.length === 0 && <p className={styles.hint}>{t('seller.listings_none')}</p>}
      <ul className={styles.list}>
        {items.map((l) => (
          <li key={l.id} className={styles.row}>
            <Link to={l.status === 'draft' || l.status === 'pending_review' ? `/sell/${encodeURIComponent(l.id)}` : `/listings/${encodeURIComponent(l.id)}`}><strong>{l.title}</strong></Link>
            <p>
              {t(`seller.format.${l.saleFormat}`)}
              {l.price ? ` · ${formatMoney(BigInt(l.price), lang)}` : ''}
              {l.saleFormat === 'fixed_price' ? ` · ${t('seller.available', { available: toLocalDigits(String(l.quantity.available), lang), total: toLocalDigits(String(l.quantity.total), lang) })}` : ''}
            </p>
          </li>
        ))}
      </ul>
      {listings.hasNextPage && <button type="button" className={styles.secondary} onClick={() => void listings.fetchNextPage()}>{t('seller.more')}</button>}
    </section>
  );
}

const listingsError = (e: unknown, t: T, lang: Lang) => (isApiError(e, 403) ? t('seller.verify') : errorText(e, t, lang));

function Payouts({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const account = useQuery({
    queryKey: ['me', 'payout-account'],
    queryFn: ({ signal }) => api.get('/me/payout-account', { signal }) as Promise<{ account: PayoutAccount | null }>,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  const payouts = useQuery({
    queryKey: ['me', 'payouts'],
    queryFn: ({ signal }) => api.get('/me/payouts', { signal }) as Promise<{ items: PayoutRow[]; nextCursor: string | null }>,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  const a = account.data?.account ?? null;
  return (
    <section aria-labelledby="payouts-title" className={styles.panel}>
      <h2 id="payouts-title">{t('seller.payouts_title')}</h2>
      {(payouts.data?.items ?? []).some((p) => p.simulated) && <SimulatedBanner kind="payment" />}
      <h3>{t('seller.account_title')}</h3>
      {account.isError && <FormMessage kind="error">{listingsError(account.error, t, lang)}</FormMessage>}
      {account.isSuccess && !a && <p>{t('seller.account_none')}</p>}
      {a && <p>{accountLine(a, t)} · <strong>{accountStatus(a, t, lang)}</strong></p>}
      {(account.isSuccess || isApiError(account.error, 404)) && <p><Link to="/account/payout">{t(a ? 'seller.account_change' : 'seller.account_add')}</Link></p>}
      <h3>{t('seller.payouts_list')}</h3>
      {payouts.isSuccess && payouts.data.items.length === 0 && <p className={styles.hint}>{t('seller.payouts_none')}</p>}
      <ul className={styles.list}>
        {(payouts.data?.items ?? []).map((p) => (
          <li key={p.id} className={styles.row}>
            <strong>{formatMoney(BigInt(p.amount), lang)}</strong> · {t(`seller.payout.${p.status}`)}
            {p.simulated ? ` · ${t('seller.simulated')}` : ''}
            <p className={styles.hint}>
              <Link to={`/orders/${encodeURIComponent(p.orderId)}`}>{t('seller.payout_order')}</Link>
              {' · '}{formatDateTime(Date.parse(p.sentAt ?? p.createdAt), lang)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Statements({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const statements = useInfiniteQuery({
    queryKey: ['me', 'statements'],
    queryFn: ({ pageParam, signal }) =>
      api.get(`/me/statements${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }) as Promise<{ items: Statement[]; owed: string; nextCursor: string | null }>,
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  const pages = statements.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const money = (s: string) => formatMoney(BigInt(s), lang, { decimals: 'always' });
  return (
    <section aria-labelledby="statements-title" className={styles.panel}>
      <h2 id="statements-title">{t('seller.statements_title')}</h2>
      {pages[0] && <p><strong>{t('seller.owed', { amount: formatMoney(BigInt(pages[0].owed), lang) })}</strong></p>}
      {statements.isError && <FormMessage kind="error">{listingsError(statements.error, t, lang)}</FormMessage>}
      {statements.isSuccess && items.length === 0 && <p className={styles.hint}>{t('seller.statements_none')}</p>}
      {items.map((s) => (
        <article key={s.orderId} className={styles.statement} aria-label={s.title ?? s.orderId}>
          <h3><Link to={`/orders/${encodeURIComponent(s.orderId)}`}>{s.title ?? t('seller.untitled')}</Link></h3>
          <p className={styles.hint}>{t('seller.settled', { at: formatDateTime(Date.parse(s.settledAt), lang) })}</p>
          <dl className={styles.breakdown}>
            <dt>{t('seller.line.collected')}</dt><dd>{money(s.amountCollected)}</dd>
            <dt>{t('seller.line.item')}</dt><dd>{money(s.itemPrice)}</dd>
            <dt>{t('seller.line.delivery')}</dt><dd>{money(s.deliveryFee)}</dd>
            <dt>{t('seller.line.commission')}</dt><dd>−{money(s.commission)}</dd>
            {s.refundTotal !== '0' && <><dt>{t('seller.line.refund')}</dt><dd>−{money(s.refundTotal)}</dd></>}
            <dt className={styles.total}>{t('seller.line.payout')}</dt><dd className={styles.total}>{money(s.sellerPayout)}</dd>
          </dl>
          {s.payout && <p className={styles.hint}>{t('seller.statement_payout', { status: t(`seller.payout.${s.payout.status}`) })}</p>}
        </article>
      ))}
      {statements.hasNextPage && <button type="button" className={styles.secondary} onClick={() => void statements.fetchNextPage()}>{t('seller.more')}</button>}
    </section>
  );
}
