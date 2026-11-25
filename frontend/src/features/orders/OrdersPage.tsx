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
import { moneyText } from './moneyText';
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
  return (
    <div className={styles.page}>
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
      <ul className={styles.list}>
        {items.map((o) => (
          <li key={o.id} className={styles.row}>
            <div className={styles.rowMain}>
              <Link to={`/orders/${encodeURIComponent(o.id)}`}><strong>{o.listing.title}</strong></Link>
              <p>{t(`order.status.${o.status}`)}{o.createdAt ? ` · ${formatDateTime(Date.parse(o.createdAt), lang)}` : ''}</p>
              <p className={styles.hint}>{moneyText(o, t, lang)}</p>
            </div>
            <p className={styles.rowAmount}>{formatMoney(BigInt(o.total), lang)}</p>
          </li>
        ))}
      </ul>
      {orders.hasNextPage && (
        <button type="button" className={styles.secondary} disabled={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}>{t('orders.more')}</button>
      )}
    </div>
  );
}
