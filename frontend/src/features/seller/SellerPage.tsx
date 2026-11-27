// The seller dashboard, /seller (docs/design/08_frontend.pdf section 7.8; IF-UI-08; FR-PAY-17, FR-PAY-21; U8-09):
// orders needing action with their deadlines first, listings by state, the payout account and its check status,
// payouts and statements. Every figure comes from the server; the dashboard computes nothing about money.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { dateParts, formatCountdown } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { useMe } from '../../shared/me';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { postmarkDate } from '../../shared/postmark';
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

/** A time as "30 Nov 2026, 9:47 PM" in Dhaka time (the weekday is left out: the date says the day). */
function shortWhen(ms: number, lang: Lang): string {
  const p = dateParts(ms, lang);
  return `${p.day} ${p.month} ${p.year}, ${p.time} ${p.period}`;
}

/** A deadline in ruled lines: the date, the time, and what is left, right-aligned and in tabular figures (NFR-USE-08: the date, and the countdown). */
function When({ ms, now, lang, left = false }: { ms: number; now: number; lang: Lang; left?: boolean }) {
  const p = dateParts(ms, lang);
  const c = formatCountdown(ms - now, lang);
  return (
    <div className={styles.when}>
      <span className={styles.whenDate}>
        {p.day} {p.month} {p.year}
      </span>
      <span className={styles.whenTime}>
        {p.weekday}, {p.time} {p.period}
      </span>
      {left && (
        <span className={c.urgent || c.ended ? `${styles.whenLeft} ${styles.whenUrgent}` : styles.whenLeft}>
          {c.ended ? c.text : lang === 'bn' ? `আর ${c.text}` : `in ${c.text}`}
        </span>
      )}
    </div>
  );
}
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
interface PayoutRow {
  id: string;
  orderId: string;
  amount: string;
  status: string;
  simulated: boolean;
  createdAt: string;
  sentAt: string | null;
}
interface Statement {
  orderId: string;
  title: string | null;
  settledAt: string;
  amountCollected: string;
  itemPrice: string;
  deliveryFee: string;
  commission: string;
  courierPayout: string;
  sellerPayout: string;
  refundTotal: string;
  payout: { id: string; amount: string; status: string; simulated: boolean } | null;
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
        <button type="button" className={styles.secondary} onClick={() => void listings.fetchNextPage()}>
          {t('seller.more')}
        </button>
      )}
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
      {a && (
        <p>
          {accountLine(a, t)} · <strong>{accountStatus(a, t, lang)}</strong>
        </p>
      )}
      {(account.isSuccess || isApiError(account.error, 404)) && (
        <p>
          <Link to="/account/payout" className={styles.ruledButton}>
            {t(a ? 'seller.account_change' : 'seller.account_add')}
          </Link>
        </p>
      )}
      <h3>{t('seller.payouts_list')}</h3>
      {payouts.isSuccess && payouts.data.items.length === 0 && <p className={styles.hint}>{t('seller.payouts_none')}</p>}
      <ul className={styles.list}>
        {(payouts.data?.items ?? []).map((p) => (
          <li key={p.id} className={styles.payoutRow}>
            <div>
              <strong className={styles.amount}>{formatMoney(BigInt(p.amount), lang)}</strong> · {t(`seller.payout.${p.status}`)}
              {p.simulated ? ` · ${t('seller.simulated')}` : ''}
              <p className={styles.hint}>
                <Link to={`/orders/${encodeURIComponent(p.orderId)}`}>{t('seller.payout_order')}</Link>
              </p>
            </div>
            <When ms={Date.parse(p.sentAt ?? p.createdAt)} now={0} lang={lang} />
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
      api.get(`/me/statements${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }) as Promise<{
        items: Statement[];
        owed: string;
        nextCursor: string | null;
      }>,
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  const pages = statements.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const money = (s: string) => formatMoney(BigInt(s), lang, { decimals: 'always' });
  // the day a payout was sent comes with the payouts (the same request as the panel above)
  const payouts = useQuery({
    queryKey: ['me', 'payouts'],
    queryFn: ({ signal }) => api.get('/me/payouts', { signal }) as Promise<{ items: PayoutRow[]; nextCursor: string | null }>,
    retry: false,
  });
  const sentAt = new Map((payouts.data?.items ?? []).filter((p) => p.status === 'sent' && p.sentAt).map((p) => [p.id, p.sentAt!]));
  return (
    <section aria-labelledby="statements-title" className={styles.panel}>
      <h2 id="statements-title">{t('seller.statements_title')}</h2>
      {pages[0] && (
        <p>
          <strong>{t('seller.owed', { amount: formatMoney(BigInt(pages[0].owed), lang) })}</strong>
        </p>
      )}
      {statements.isError && <FormMessage kind="error">{listingsError(statements.error, t, lang)}</FormMessage>}
      {statements.isSuccess && items.length === 0 && <p className={styles.hint}>{t('seller.statements_none')}</p>}
      {items.map((s) => (
        <article key={s.orderId} aria-label={s.title ?? s.orderId}>
          {/* a statement is a ruled line: the order, the payout as the one big figure, then the breakdown on hairlines; the day the payout was sent is
              plain text (U10-24) */}
          <div className={styles.stmtHead}>
            <h3 className={styles.stubHeading}>
              <Link to={`/orders/${encodeURIComponent(s.orderId)}`}>{s.title ?? t('seller.untitled')}</Link>
            </h3>
            <p className={styles.stubNote}>{t('seller.settled', { at: shortWhen(Date.parse(s.settledAt), lang) })}</p>
          </div>
          <p className={styles.figure} aria-hidden="true">
            {formatMoney(BigInt(s.sellerPayout), lang)}
          </p>
          <dl className={styles.breakdown}>
            <dt>{t('seller.line.collected')}</dt>
            <dd>{money(s.amountCollected)}</dd>
            <dt>{t('seller.line.item')}</dt>
            <dd>{money(s.itemPrice)}</dd>
            <dt>{t('seller.line.delivery')}</dt>
            <dd>{money(s.deliveryFee)}</dd>
            <dt>{t('seller.line.commission')}</dt>
            <dd>−{money(s.commission)}</dd>
            {s.refundTotal !== '0' && (
              <>
                <dt>{t('seller.line.refund')}</dt>
                <dd>−{money(s.refundTotal)}</dd>
              </>
            )}
            <dt className={styles.total}>{t('seller.line.payout')}</dt>
            <dd className={styles.total}>{money(s.sellerPayout)}</dd>
          </dl>
          {s.payout && (
            <p className={styles.hint}>
              {t('seller.statement_payout', { status: t(`seller.payout.${s.payout.status}`) })}
              {s.payout && sentAt.has(s.payout.id) ? ` · ${postmarkDate(sentAt.get(s.payout.id)!, lang)}` : ''}
            </p>
          )}
        </article>
      ))}
      {statements.hasNextPage && (
        <button type="button" className={styles.secondary} onClick={() => void statements.fetchNextPage()}>
          {t('seller.more')}
        </button>
      )}
    </section>
  );
}
