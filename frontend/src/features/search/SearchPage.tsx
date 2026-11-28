// Search (docs/design/08_frontend.pdf section 7.3; IF-UI-03; FR-SRC-01 to FR-SRC-05; U8-04; Daylight design,
// docs/design/10_visual.md, section 7.2: the words on top, the filters in a column beside the results on wide screens
// and behind a "Show filters" button on phones, the active filters as removable chips). The filters
// live in the URL, so a search can be shared and the back button works; pages are added with "Show more" rather
// than endless scrolling, so the footer stays reachable. Distances come from the server in whole kilometres. The
// location is asked for only when "Use my location" is pressed (I-58); signed-in users otherwise search from the
// area saved in their account (Unit 3). The area list arrives with Unit 4's /delivery/areas (U4-02).

import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';

import { useT } from '../../shared/language/Language';

import { useMe } from '../../shared/me';
import { problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import en from '../../messages/en/search.json';
import bn from '../../messages/bn/search.json';
import { ListingCard } from './ListingCard';
import styles from './search.module.css';
import { Button } from '../../shared/ui';
import { Filters } from './SearchFilters';
import { Category, PARAMS } from './searchShared';
import { ActiveFilters } from './SearchActiveFilters';

const CATALOGUES = { en, bn };
export interface SearchCard {
  id: string;
  title: string;
  itemKind: 'physical' | 'game_account';
  saleFormat: 'fixed_price' | 'auction';
  condition: string | null;
  district: string | null;
  price: string;
  thumbUrl: string | null;
  distanceKm: number | null;
  featured: boolean;
  currentlyReserved: boolean;
  auction: { endAt: string | null; bidCount: number; reserveMet: boolean } | null;
}
export interface SearchPage {
  items: SearchCard[];
  nextCursor: string | null;
  featured: SearchCard[];
  sort: string;
}

/** The request's query string: the page's own parameters, in a fixed order, so equal searches share a cache entry. */
export function searchQuery(params: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of PARAMS) {
    const v = params.get(k);
    if (v) q.set(k, v);
  }
  return q;
}

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const query = searchQuery(params);
  const key = query.toString();

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => api.get('/categories', { signal }) as Promise<Category[]>,
    staleTime: FRESHNESS.reference,
  });
  const pages = useInfiniteQuery({
    queryKey: ['search', key],
    queryFn: ({ pageParam, signal }) => {
      const q = new URLSearchParams(query);
      if (pageParam) q.set('cursor', pageParam);
      const s = q.toString();
      return api.get('/search' + (s ? '?' + s : ''), { signal }) as Promise<SearchPage>;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SearchPage) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.search,
    retry: false,
  });

  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('search.title')}</h1>
      <p className={styles.lead}>{t('search.lead')}</p>
      <Filters key={key} t={t} lang={lang} params={query} categories={categories.data ?? []} signedIn={me.isSuccess} onSearch={(next) => setParams(next)} />
      <ActiveFilters t={t} lang={lang} params={query} categories={categories.data ?? []} onChange={(next) => setParams(next)} />
      {pages.isPending && (
        <div className={styles.status}>
          <p role="status" className={styles.visuallyHidden}>
            {t('shell.loading')}
          </p>
          <h2 className={styles.loadingTitle} aria-hidden="true">
            {t('search.results')}
          </h2>
          <ul className={styles.cards} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
              <li key={n} className={styles.skeleton}>
                <i />
                <i />
                <i />
              </li>
            ))}
          </ul>
        </div>
      )}
      {pages.isError && (
        <div className={styles.status}>
          <FormMessage kind="error">
            {problemName(pages.error) === 'validation-failed' && (query.get('sort') === 'distance' || query.has('maxKm'))
              ? t('search.needs_point')
              : errorText(pages.error, t, lang)}
          </FormMessage>
        </div>
      )}
      {pages.data && (
        <div className={styles.results}>
          {pages.data.pages[0].featured.length > 0 && (
            <section aria-labelledby="featured-title" className={styles.featured}>
              <h2 id="featured-title">{t('search.featured')}</h2>
              <p className={styles.hint}>{t('search.featured_note')}</p>
              <ul className={styles.cards}>
                {pages.data.pages[0].featured.map((c) => (
                  <ListingCard key={c.id} c={c} t={t} lang={lang} />
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="results-title">
            <h2 id="results-title">{t('search.results')}</h2>
            {items.length === 0 ? (
              <p className={styles.empty}>{t('search.empty')}</p>
            ) : (
              <ul className={styles.cards}>
                {items.map((c) => (
                  <ListingCard key={c.id} c={c} t={t} lang={lang} />
                ))}
              </ul>
            )}
            {pages.hasNextPage && (
              <div className={styles.moreRow}>
                <Button variant="secondary" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                  {t('search.more')}
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
