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
import { ordersKey, ORDER_STAGES, type OrderStage, type OrderView } from './model';
import { downloadReceipt, hasReceipt } from './receipt';
import en from '../../messages/en/orders.json';
import bn from '../../messages/bn/orders.json';
import styles from './orders.module.css';
import { Button } from '../../shared/ui';

const CATALOGUES = { en, bn };

/** The status as the stage tabs read it: where the order is, in a few words. */
function statusWords(o: OrderView, stage: OrderStage, t: (k: string) => string): string {
  if (o.status === 'awaiting_payment') return t('orders.state.awaiting_payment');
  if (o.status === 'cancelled') return t('orders.state.cancelled');
  if (o.status === 'closed') return t('orders.state.closed');
  if (o.escrow?.state === 'frozen_disputed') return t('orders.state.disputed');
  if (stage !== 'on_the_way') return t('orders.state.paid');
  return t(o.fulfilment === 'courier' ? 'orders.state.on_the_way' : 'orders.state.handed_over');
}

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const role = params.get('role') === 'seller' ? 'seller' : 'buyer';
  const stage: OrderStage = ORDER_STAGES.find((x) => x === params.get('stage')) ?? 'orders';
  const orders = useInfiniteQuery({
    queryKey: ordersKey(role, stage),
    queryFn: ({ pageParam, signal }) =>
      api.get(`/orders?role=${role}&stage=${stage}` + (pageParam ? '&cursor=' + encodeURIComponent(pageParam) : ''), { signal }) as Promise<{
        items: OrderView[];
        nextCursor: string | null;
      }>,
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  if (orders.isError && isApiError(orders.error, 401))
    return (
      <p>
        <Link to={signInPath('/orders')}>{t('order.sign_in')}</Link>
      </p>
    );
  const items = orders.data?.pages.flatMap((p) => p.items) ?? [];
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
      <nav aria-label={t('orders.stages')} className={styles.stageTabs}>
        {ORDER_STAGES.map((x, i) => (
          <button
            key={x}
            type="button"
            aria-pressed={stage === x}
            className={stage === x ? styles.stageOn : styles.stageTab}
            onClick={() => setParams({ role, stage: x })}
          >
            <span className={styles.stageNo} aria-hidden="true">
              {i + 1}
            </span>
            {t(`orders.stage.${x}.${role}`)}
          </button>
        ))}
      </nav>
      {orders.isPending && <p role="status">{t('shell.loading')}</p>}
      {orders.isError && <FormMessage kind="error">{errorText(orders.error, t, lang)}</FormMessage>}
      {orders.isSuccess && items.length === 0 && <p>{t(`orders.none.stage.${stage}`)}</p>}
      {items.length > 0 && (
        <section aria-label={t(`orders.stage.${stage}.${role}`)} className={styles.ordersSection}>
          <div className={styles.gridHead} aria-hidden="true">
            <span />
            <span>{t('orders.col.item')}</span>
            <span>{t('orders.col.status')}</span>
            <span>{t(`orders.col.${role === 'buyer' ? 'seller' : 'buyer'}`)}</span>
            <span className={styles.alignEnd}>{t('orders.col.money')}</span>
            <span />
          </div>
          <ul className={styles.list}>
            {items.map((o) => {
              const who = o.counterparty?.displayName || '';
              return (
                <li key={o.id} className={styles.gridRow}>
                  <div className={styles.thumb}>
                    {o.listing.photoKey && (
                      <img src={`/api/v1/listing-photos/${encodeURIComponent(o.listing.photoKey)}?size=thumb`} alt="" width={64} height={64} loading="lazy" />
                    )}
                  </div>
                  <div className={styles.cellMain}>
                    <Link to={`/orders/${encodeURIComponent(o.id)}`}>
                      <strong>{o.listing.title}</strong>
                    </Link>
                    {o.createdAt && <p className={styles.hint}>{formatDateTime(Date.parse(o.createdAt), lang)}</p>}
                  </div>
                  <div className={styles.cell} data-label={t('orders.col.status')}>
                    <p className={o.status === 'cancelled' ? styles.cancelledMark : undefined}>{statusWords(o, stage, t)}</p>
                  </div>
                  <div className={styles.cell} data-label={t(`orders.col.${role === 'buyer' ? 'seller' : 'buyer'}`)}>
                    <p>{who || '—'}</p>
                  </div>
                  <div className={`${styles.cell} ${styles.alignEnd}`} data-label={t('orders.col.money')}>
                    <p className={styles.rowAmount}>{formatMoney(BigInt(o.total), lang)}</p>
                  </div>
                  <div className={styles.cellAction}>
                    {hasReceipt(o) && (
                      <button
                        type="button"
                        className={styles.receipt}
                        aria-label={t('orders.receipt_for', { title: o.listing.title })}
                        onClick={() => downloadReceipt(o, t, lang, role === 'buyer' ? who || null : null)}
                      >
                        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                          <path
                            d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span>{t('orders.receipt')}</span>
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {orders.hasNextPage && (
        <Button variant="secondary" type="button" disabled={orders.isFetchingNextPage} onClick={() => void orders.fetchNextPage()}>
          {t('orders.more')}
        </Button>
      )}
    </div>
  );
}
