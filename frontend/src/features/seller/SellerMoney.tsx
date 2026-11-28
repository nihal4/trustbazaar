// The seller dashboard's money: the payout account with the payouts, and the statements of settled orders. Every figure comes from the server.
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { postmarkDate } from '../../shared/postmark';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { SimulatedBanner } from '../../shared/SimulatedBanner';
import { accountLine, accountStatus, type PayoutAccount } from './model';
import { listingsError, shortWhen, When } from './sellerShared';
import styles from './seller.module.css';
import { Button } from '../../shared/ui';

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

export function Payouts({ t, lang }: { t: T; lang: Lang }) {
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

export function Statements({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const statements = useInfiniteQuery({
    queryKey: ['me', 'statements'],
    queryFn: ({ pageParam, signal }) =>
      api.get('/me/statements' + (pageParam ? '?cursor=' + encodeURIComponent(pageParam) : ''), { signal }) as Promise<{
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
        <Button variant="secondary" type="button" onClick={() => void statements.fetchNextPage()}>
          {t('seller.more')}
        </Button>
      )}
    </section>
  );
}
