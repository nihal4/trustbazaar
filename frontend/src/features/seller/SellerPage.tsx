// The seller dashboard, /seller (docs/design/08_frontend.pdf section 7.8; IF-UI-08; FR-PAY-17, FR-PAY-21; U8-09):
// orders needing action with their deadlines first, listings by state, the payout account and its check status,
// payouts and statements. Every figure comes from the server; the dashboard computes nothing about money.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { useMe } from '../../shared/me';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { accountStatus, needingAction, type PayoutAccount, type SellerOrder } from './model';
import en from '../../messages/en/seller.json';
import bn from '../../messages/bn/seller.json';
import { listingsError, When } from './sellerShared';
import { Payouts, Statements } from './SellerMoney';
import styles from './seller.module.css';
import { Button } from '../../shared/ui';

const CATALOGUES = { en, bn };

const LISTING_STATES = ['active', 'pending_review', 'draft', 'sold', 'ended_unsold', 'cancelled', 'removed'] as const;
type ListingState = (typeof LISTING_STATES)[number];

interface MyListing {
  id: string;
  title: string;
  status: ListingState;
  saleFormat: 'fixed_price' | 'auction';
  price: string | null;
  quantity: { total: number; available: number };
  createdAt: string;
  publishedAt: string | null;
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
  if (orders.isError && isApiError(orders.error, 401))
    return (
      <p>
        <Link to={signInPath('/seller')}>{t('seller.sign_in')}</Link>
      </p>
    );
  return (
    <div className={styles.page}>
      {/* the header's Sell an item is the one way to a new listing: no second button here */}
      <div className={styles.head}>
        <h1>{t('seller.title')}</h1>
      </div>
      <Figures orders={orders.data?.items ?? null} t={t} lang={lang} />
      {/* two columns divided by one line: what to do and what is for sale on the left, the money on the right */}
      <div className={styles.cols}>
        <div className={styles.col}>
          <ActionNeeded orders={orders.data?.items ?? null} error={orders.error} t={t} lang={lang} />
          <Listings t={t} lang={lang} />
        </div>
        <div className={styles.col}>
          <Payouts t={t} lang={lang} />
          <Statements t={t} lang={lang} />
        </div>
      </div>
    </div>
  );
}

/** Four figures divided by lines: what needs the seller, what TrustBazaar owes them, the payout account, and the deals done. All from the server (nothing computed about money). */
function Figures({ orders, t, lang }: { orders: SellerOrder[] | null; t: T; lang: Lang }) {
  const api = useApi();
  const me = useMe();
  const id = me.data?.id;
  const account = useQuery({
    queryKey: ['me', 'payout-account'],
    queryFn: ({ signal }) => api.get('/me/payout-account', { signal }) as Promise<{ account: PayoutAccount | null }>,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  const owed = useQuery({
    queryKey: ['me', 'statements', 'owed'],
    queryFn: ({ signal }) => api.get('/me/statements', { signal }) as Promise<{ owed: string }>,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  const trust = useQuery({
    queryKey: ['trust', id],
    queryFn: ({ signal }) => api.get(`/users/${id}/trust`, { signal }) as Promise<{ completedTransactions: number }>,
    enabled: Boolean(id),
    staleTime: 60_000,
    retry: false,
  });
  const a = account.data?.account ?? null;
  const dash = '–';
  return (
    <dl className={styles.figures}>
      <div>
        <dt>{t('seller.action_title')}</dt>
        <dd>{orders ? toLocalDigits(String(needingAction(orders).length), lang) : dash}</dd>
      </div>
      <div>
        <dt>{t('seller.fig_owed')}</dt>
        <dd>{owed.data ? formatMoney(BigInt(owed.data.owed), lang) : dash}</dd>
      </div>
      <div>
        <dt>{t('seller.account_title')}</dt>
        <dd className={styles.figText}>{account.isSuccess ? (a ? accountStatus(a, t, lang) : t('seller.fig_none')) : dash}</dd>
      </div>
      <div>
        <dt>{t('seller.fig_completed')}</dt>
        <dd>{trust.data ? toLocalDigits(String(trust.data.completedTransactions), lang) : dash}</dd>
      </div>
    </dl>
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
          <li key={o.id} className={styles.orderRow}>
            <div className={styles.orderMain}>
              <Link to={`/orders/${encodeURIComponent(o.id)}`}>
                <strong>{o.listing.title}</strong>
              </Link>
              <p>{t(`seller.why.${why}`)}</p>
            </div>
            {due !== null && <When ms={due} now={now} lang={lang} left />}
          </li>
        ))}
      </ul>
      <p>
        <Link to="/orders?role=seller" className={styles.ruledButton}>
          {t('seller.all_sales')}
        </Link>
      </p>
    </section>
  );
}

function Listings({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const [state, setState] = useState<ListingState>('active');
  const listings = useInfiniteQuery({
    queryKey: ['me', 'listings', state],
    queryFn: ({ pageParam, signal }) =>
      api.get(`/me/listings?status=${state}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }) as Promise<{
        items: MyListing[];
        nextCursor: string | null;
      }>,
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
        {LISTING_STATES.map((s) => (
          <option key={s} value={s}>
            {t(`seller.state.${s}`)}
          </option>
        ))}
      </select>
      {listings.isPending && <p role="status">{t('shell.loading')}</p>}
      {listings.isError && <FormMessage kind="error">{listingsError(listings.error, t, lang)}</FormMessage>}
      {listings.isSuccess && items.length === 0 && <p className={styles.hint}>{t('seller.listings_none')}</p>}
      <ul className={styles.list}>
        {items.map((l) => (
          <li key={l.id} className={styles.row}>
            <Link to={l.status === 'draft' || l.status === 'pending_review' ? `/sell/${encodeURIComponent(l.id)}` : `/listings/${encodeURIComponent(l.id)}`}>
              <strong>{l.title}</strong>
            </Link>
            <p>
              {t(`seller.format.${l.saleFormat}`)}
              {l.price ? ` · ${formatMoney(BigInt(l.price), lang)}` : ''}
              {l.saleFormat === 'fixed_price'
                ? ` · ${t('seller.available', { available: toLocalDigits(String(l.quantity.available), lang), total: toLocalDigits(String(l.quantity.total), lang) })}`
                : ''}
            </p>
          </li>
        ))}
      </ul>
      {listings.hasNextPage && (
        <Button variant="secondary" type="button" onClick={() => void listings.fetchNextPage()}>
          {t('seller.more')}
        </Button>
      )}
    </section>
  );
}
