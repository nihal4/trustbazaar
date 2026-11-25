// /orders (docs/design/08_frontend.pdf section 3.3; IF-UI-05; U8-06): the member's orders as buyer or as seller,
// newest first, 50 a page, each with its status, total and the sentence of where the money is. The order view has
// the rest.
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { ordersKey, type OrderView } from './model';
import { downloadReceipt, hasReceipt } from './receipt';
import en from '../../messages/en/orders.json';
import bn from '../../messages/bn/orders.json';
import styles from './orders.module.css';

const CATALOGUES = { en, bn };

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const role = params.get('role') === 'seller' ? 'seller' : 'buyer';
  const orders = useInfiniteQuery({
    queryKey: ordersKey(role),
    queryFn: ({ pageParam, signal }) =>
      api.get(`/orders?role=${role}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`, { signal }) as Promise<{ items: OrderView[]; nextCursor: string | null }>,
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  if (orders.isError && isApiError(orders.error, 401)) return <p><Link to={signInPath('/orders')}>{t('order.sign_in')}</Link></p>;
  const items = orders.data?.pages.flatMap((p) => p.items) ?? [];
  // bought (or sold) orders, whether waiting, paid or finished, are kept apart from the cancelled ones
  const sections = [
    { key: 'active', rows: items.filter((o) => o.status !== 'cancelled') },
    { key: 'cancelled', rows: items.filter((o) => o.status === 'cancelled') },
  ];
  return (
    <div className={`${styles.page} ${styles.wide}`}>
      <h1>{t('orders.title')}</h1>
      <nav aria-label={t('orders.roles')} className={styles.tabs}>
        {(['buyer', 'seller'] as const).map((r) => (
          <button key={r} type="button" aria-pressed={role === r} className={role === r ? styles.tabOn : styles.tab} onClick={() => setParams({ role: r })}>
            {t(`orders.as.${r}`)}
          </button>
        ))}
      </nav>
      {orders.isPending && <p role="status">{t('shell.loading')}</p>}
      {orders.isError && <FormMessage kind="error">{errorText(orders.error, t, lang)}</FormMessage>}
      {orders.isSuccess && items.length === 0 && <p>{t(`orders.none.${role}`)}</p>}
      {sections.map(({ key, rows }) => rows.length > 0 && (
        <section key={key} aria-labelledby={`orders-${key}`} className={styles.ordersSection}>
          <h2 id={`orders-${key}`} className={styles.sectionTitle}>{t(`orders.section.${key === 'active' ? role : 'cancelled'}`)} <span className={styles.count}>{rows.length}</span></h2>
          <div className={styles.gridHead} aria-hidden="true">
            <span /><span>{t('orders.col.item')}</span><span>{t('orders.col.status')}</span><span>{t(`orders.col.${role === 'buyer' ? 'seller' : 'buyer'}`)}</span><span className={styles.alignEnd}>{t('orders.col.money')}</span><span />
          </div>
          <ul className={styles.list}>
            {rows.map((o) => {
              const who = o.counterparty?.displayName || '';
              return (
                <li key={o.id} className={styles.gridRow}>
                  <div className={styles.thumb}>
                    {o.listing.photoKey && <img src={`/api/v1/listing-photos/${encodeURIComponent(o.listing.photoKey)}?size=thumb`} alt="" width={64} height={64} loading="lazy" />}
                  </div>
                  <div className={styles.cellMain}>
                    <Link to={`/orders/${encodeURIComponent(o.id)}`}><strong>{o.listing.title}</strong></Link>
                    {o.createdAt && <p className={styles.hint}>{formatDateTime(Date.parse(o.createdAt), lang)}</p>}
                  </div>
                  <div className={styles.cell} data-label={t('orders.col.status')}>
                    <p>{t(`order.status.${o.status}`)}</p>
                  </div>
                  <div className={styles.cell} data-label={t(`orders.col.${role === 'buyer' ? 'seller' : 'buyer'}`)}>
                    <p>{who || '—'}</p>
                  </div>
                  <div className={`${styles.cell} ${styles.alignEnd}`} data-label={t('orders.col.money')}>
                    <p className={styles.rowAmount}>{formatMoney(BigInt(o.total), lang)}</p>
                  </div>
                  <div className={styles.cellAction}>
                    {hasReceipt(o) && (
                      <button type="button" className={styles.receipt} aria-label={t('orders.receipt_for', { title: o.listing.title })} onClick={() => downloadReceipt(o, t, lang, role === 'buyer' ? who || null : null)}>
                        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span>{t('orders.receipt')}</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {orders.hasNextPage && (
        <button type="button" className={styles.secondary} disabled={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}>{t('orders.more')}</button>
      )}
    </div>
  );
}
