// The thread list (IF-UI-07; section 3.3, /messages): newest first, with the other party by display name and badge
// (FR-ACC-10), the listing, and the unread count in words as well as a number. A new message anywhere refreshes it.
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { dateParts } from '../../lib/time.js';
import { toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { AccountTabs } from '../../shared/AccountTabs';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { Tick } from '../../shared/icons';
import { useT } from '../../shared/language/Language';
import { useLiveEvent } from '../../shared/live';
import { useMe } from '../../shared/me';
import { FRESHNESS } from '../../shared/query';
import en from '../../messages/en/chat.json';
import bn from '../../messages/bn/chat.json';
import { fetchThreads, THREADS_KEY, type ThreadPage } from './model';
import styles from './chat.module.css';

const CATALOGUES = { en, bn };

/** The first letter of the other party's name, for the photo place of a row (there is no photo upload). */
const initialOf = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const me = useMe();
  const api = useApi();
  const queryClient = useQueryClient();
  const pages = useInfiniteQuery({
    queryKey: [...THREADS_KEY, 'list'],
    queryFn: ({ pageParam, signal }) => fetchThreads(api, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ThreadPage) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.money,
    retry: false,
    enabled: me.isSuccess,
  });
  useLiveEvent('chat.message', () => void queryClient.invalidateQueries({ queryKey: THREADS_KEY }), me.isSuccess);

  if (me.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (me.isError) {
    return (
      <div className={styles.page}>
        <h1>{t('chat.title')}</h1>
        <p>{t('chat.signed_out')}</p>
        <p><Link to={`/signin?next=${encodeURIComponent('/messages')}`}>{t('shell.sign_in')}</Link></p>
      </div>
    );
  }
  if (pages.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (pages.isError) return <div className={styles.page}><h1>{t('chat.title')}</h1><FormMessage kind="error">{errorText(pages.error, t, lang)}</FormMessage></div>;

  const items = pages.data.pages.flatMap((p) => p.items);
  return (
    <div className={styles.page}>
      <AccountTabs t={t} />
      <h1>{t('chat.title')}</h1>
      {items.length === 0
        ? <p>{t('chat.empty')}</p>
        : (
          <ul className={styles.threads} aria-label={t('chat.list')}>
            {items.map((th) => (
              <li key={th.id} className={th.unread > 0 ? styles.unreadThread : undefined}>
                <Link to={`/messages/${encodeURIComponent(th.id)}`} className={styles.threadLink}>
                  <span className={styles.avatar} aria-hidden="true">{initialOf(th.other?.displayName ?? '?')}</span>
                  <span className={styles.threadMain}>
                    <span className={styles.name}>
                      {th.other?.displayName ?? t('chat.closed_account')}
                      {th.other?.verified && <span className={styles.tick} title={t('chat.verified')}><Tick /><span className={styles.visuallyHidden}>{t('chat.verified')}</span></span>}
                    </span>
                    <span className={styles.about}>
                      <span className={styles.productTag}>{t('chat.about', { title: th.listing.title ?? t('chat.listing_gone') })}</span>
                      <span className={styles.role}>
                        {t(th.role === 'buyer' ? 'chat.buying' : 'chat.selling')}
                        {th.closed && <> · {t('chat.closed')}</>}
                      </span>
                    </span>
                  </span>
                  <span className={styles.threadSide}>
                    {th.lastMessageAt && (() => {
                      const p = dateParts(Date.parse(th.lastMessageAt), lang);
                      return <time dateTime={th.lastMessageAt} className={styles.when}><span className={styles.whenDate}>{p.day} {p.month} {p.year}</span><span className={styles.whenTime}>{p.weekday}, {p.time} {p.period}</span></time>;
                    })()}
                    {th.unread > 0 && <span className={styles.unread}>{t('chat.unread', { count: toLocalDigits(String(th.unread), lang) })}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      {pages.hasNextPage && (
        <button type="button" className={styles.secondary} onClick={() => void pages.fetchNextPage()} disabled={pages.isFetchingNextPage}>
          {t('chat.more')}
        </button>
      )}
    </div>
  );
}
