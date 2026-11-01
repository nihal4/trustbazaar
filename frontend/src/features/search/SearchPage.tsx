// Home and search (docs/design/08_frontend.pdf section 7.3; IF-UI-03; FR-SRC-01 to FR-SRC-05; U8-04). The filters
// live in the URL, so a search can be shared and the back button works; pages are added with "Show more" rather
// than endless scrolling, so the footer stays reachable. Distances come from the server in whole kilometres. The
// location is asked for only when "Use my location" is pressed (I-58); signed-in users otherwise search from the
// area saved in their account (Unit 3). The area list arrives with Unit 4's /delivery/areas (U4-02).
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { formatMoney, parseTaka, toLocalDigits } from '../../lib/money.js';
import { formatCountdown } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { useMe } from '../../shared/me';
import { problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import en from '../../messages/en/search.json';
import bn from '../../messages/bn/search.json';
import styles from './search.module.css';

const CATALOGUES = { en, bn };

export interface Category { id: number; parentId: number | null; slug: string; nameEn: string; nameBn: string; itemKind: string; selectable: boolean }
export interface SearchCard {
  id: string; title: string; itemKind: 'physical' | 'game_account'; saleFormat: 'fixed_price' | 'auction'; condition: string | null;
  district: string | null; price: string; thumbUrl: string | null; distanceKm: number | null; featured: boolean; currentlyReserved: boolean;
  auction: { endAt: string | null; bidCount: number; reserveMet: boolean } | null;
}
export interface SearchPage { items: SearchCard[]; nextCursor: string | null; featured: SearchCard[]; sort: string }

/** The parameters GET /search takes, in the page's URL under the same names (Decisions log, U3-03). */
export const PARAMS = ['q', 'category', 'itemKind', 'saleFormat', 'condition', 'minPrice', 'maxPrice', 'maxKm', 'lat', 'lng', 'sort'] as const;
const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'distance', 'ending_soon'] as const;
const CONDITIONS = ['new', 'like_new', 'used', 'for_parts'] as const;

/** The request's query string: the page's own parameters, in a fixed order, so equal searches share a cache entry. */
export function searchQuery(params: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of PARAMS) {
    const v = params.get(k);
    if (v) q.set(k, v);
  }
  return q;
}

/** Categories in tree order, with their depth, for an indented list. */
export function categoryTree(all: Category[]): { c: Category; depth: number }[] {
  const out: { c: Category; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => {
    for (const c of all.filter((x) => x.parentId === parent)) {
      out.push({ c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const taka = (poisha: string | null) => (poisha ? String(Number(BigInt(poisha) / 100n)) : '');

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
      return api.get(`/search${s ? `?${s}` : ''}`, { signal }) as Promise<SearchPage>;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: SearchPage) => last.nextCursor ?? undefined,
    staleTime: FRESHNESS.search,
    retry: false,
  });

  return (
    <div className={styles.page}>
      <h1>{t('search.title')}</h1>
      <p className={styles.lead}>{t('search.lead')}</p>
      <Filters key={key} t={t} lang={lang} params={query} categories={categories.data ?? []} signedIn={me.isSuccess}
        onSearch={(next) => setParams(next)} />
      {pages.isPending && <p role="status">{t('shell.loading')}</p>}
      {pages.isError && (
        <FormMessage kind="error">
          {problemName(pages.error) === 'validation-failed' && (query.get('sort') === 'distance' || query.has('maxKm'))
            ? t('search.needs_point') : errorText(pages.error, t, lang)}
        </FormMessage>
      )}
      {pages.data && (
        <>
          {pages.data.pages[0].featured.length > 0 && (
            <section aria-labelledby="featured-title" className={styles.featured}>
              <h2 id="featured-title">{t('search.featured')}</h2>
              <p className={styles.hint}>{t('search.featured_note')}</p>
              <ul className={styles.cards}>
                {pages.data.pages[0].featured.map((c) => <Card key={c.id} c={c} t={t} lang={lang} />)}
              </ul>
            </section>
          )}
          <section aria-labelledby="results-title">
            <h2 id="results-title">{t('search.results')}</h2>
            {pages.data.pages[0].items.length === 0
              ? <p>{t('search.empty')}</p>
              : (
                <ul className={styles.cards}>
                  {pages.data.pages.flatMap((p) => p.items).map((c) => <Card key={c.id} c={c} t={t} lang={lang} />)}
                </ul>
              )}
            {pages.hasNextPage && (
              <button type="button" className={styles.more} disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
                {t('search.more')}
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}

type T = ReturnType<typeof useT>['t'];

function Filters({ t, lang, params, categories, signedIn, onSearch }: {
  t: T; lang: Lang; params: URLSearchParams; categories: Category[]; signedIn: boolean; onSearch: (next: URLSearchParams) => void;
}) {
  const [v, setV] = useState(() => ({
    q: params.get('q') ?? '', category: params.get('category') ?? '', itemKind: params.get('itemKind') ?? '',
    saleFormat: params.get('saleFormat') ?? '', condition: params.get('condition') ?? '', minPrice: taka(params.get('minPrice')),
    maxPrice: taka(params.get('maxPrice')), maxKm: params.get('maxKm') ?? '', sort: params.get('sort') ?? '',
  }));
  const [point, setPoint] = useState(() => (params.get('lat') && params.get('lng') ? { lat: params.get('lat')!, lng: params.get('lng')! } : null));
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (value: string) => setV((x) => ({ ...x, [k]: value }));

  const submit = (e?: FormEvent, at = point) => {
    e?.preventDefault();
    setMessage(null);
    const next = new URLSearchParams();
    const prices: Record<string, string> = {};
    for (const k of ['minPrice', 'maxPrice'] as const) {
      if (!v[k].trim()) continue;
      const p = parseTaka(v[k]);
      if (!p.ok || p.poisha <= 0n) return setMessage(t('search.price_invalid'));
      prices[k] = String(p.poisha);
    }
    if (prices.minPrice && prices.maxPrice && BigInt(prices.minPrice) > BigInt(prices.maxPrice)) return setMessage(t('search.price_order'));
    const values: Record<string, string> = { ...v, ...prices, q: v.q.trim(), maxKm: toAscii(v.maxKm) };
    if (!prices.minPrice) delete values.minPrice;
    if (!prices.maxPrice) delete values.maxPrice;
    if (at) Object.assign(values, at);
    for (const k of PARAMS) if (values[k]) next.set(k, values[k]);
    onSearch(next);
  };

  const locate = () => {
    if (!navigator.geolocation) return setMessage(t('search.location_denied'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // rounded here as on the server (3 decimals, about 110 m): no finer position leaves the device
        const at = { lat: pos.coords.latitude.toFixed(3), lng: pos.coords.longitude.toFixed(3) };
        setPoint(at);
        submit(undefined, at);
      },
      () => {
        setLocating(false);
        setMessage(t('search.location_denied'));
      },
      { maximumAge: 600_000, timeout: 15_000 },
    );
  };

  const name = (c: Category) => (lang === 'bn' ? c.nameBn : c.nameEn);
  return (
    <form role="search" className={styles.filters} onSubmit={submit} noValidate>
      <div className={styles.words}>
        <label htmlFor="search-q">{t('search.words')}</label>
        <input id="search-q" type="search" value={v.q} maxLength={100} onChange={(e) => set('q')(e.target.value)} />
        <button type="submit">{t('search.submit')}</button>
      </div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <fieldset className={styles.grid}>
        <legend>{t('search.filters')}</legend>
        <Select id="search-category" label={t('search.category')} value={v.category} onChange={set('category')} any={t('search.any')}
          options={categoryTree(categories).filter(({ c }) => c.selectable).map(({ c, depth }) => [String(c.id), `${' '.repeat(depth)}${name(c)}`])} />
        <Select id="search-kind" label={t('search.item_kind')} value={v.itemKind} onChange={set('itemKind')} any={t('search.any')}
          options={(['physical', 'game_account'] as const).map((k) => [k, t(`search.item_kind.${k}`)])} />
        <Select id="search-format" label={t('search.sale_format')} value={v.saleFormat} onChange={set('saleFormat')} any={t('search.any')}
          options={(['fixed_price', 'auction'] as const).map((k) => [k, t(`search.sale_format.${k}`)])} />
        <Select id="search-condition" label={t('search.condition')} value={v.condition} onChange={set('condition')} any={t('search.any')}
          options={CONDITIONS.map((k) => [k, t(`search.condition.${k}`)])} />
        <Text id="search-min" label={t('search.min_price')} value={v.minPrice} onChange={set('minPrice')} />
        <Text id="search-max" label={t('search.max_price')} value={v.maxPrice} onChange={set('maxPrice')} />
        <Text id="search-km" label={t('search.max_km')} value={v.maxKm} onChange={set('maxKm')} />
        <Select id="search-sort" label={t('search.sort')} value={v.sort} onChange={set('sort')} any={t(v.q.trim() ? 'search.sort.relevance' : 'search.sort.newest')}
          options={SORTS.map((k) => [k, t(`search.sort.${k}`)])} />
      </fieldset>
      <div className={styles.location}>
        {point
          ? (
            <>
              <p>{t('search.location_set')}</p>
              <button type="button" onClick={() => { setPoint(null); submit(undefined, null); }}>{t('search.clear_location')}</button>
            </>
          )
          : (
            <>
              {signedIn && <p className={styles.hint}>{t('search.location_saved')}</p>}
              <button type="button" onClick={locate} disabled={locating}>{locating ? t('search.locating') : t('search.use_location')}</button>
            </>
          )}
      </div>
    </form>
  );
}

const toAscii = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();

function Select({ id, label, value, onChange, options, any }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; any: string;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{any}</option>
        {options.map(([k, text]) => <option key={k} value={k}>{text}</option>)}
      </select>
    </div>
  );
}

function Text({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" inputMode="decimal" value={value} maxLength={20} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** A result: a link to the listing, its text as text, and every label in words (not colour alone). */
function Card({ c, t, lang }: { c: SearchCard; t: T; lang: Lang }) {
  return (
    <li className={styles.card}>
      <Link to={`/listings/${encodeURIComponent(c.id)}`} className={styles.cardLink}>
        {c.thumbUrl ? <img src={c.thumbUrl} alt="" width={160} height={120} loading="lazy" className={styles.thumb} /> : <span className={styles.noThumb} />}
        <span className={styles.cardBody}>
          {c.featured && <span className={styles.badge}>{t('search.card.featured')}</span>}
          <span className={styles.cardTitle}>{c.title}</span>
          <span className={styles.price}>{formatMoney(c.price, lang)}</span>
          {c.auction && <AuctionLine a={c.auction} t={t} lang={lang} />}
          {c.currentlyReserved && <span className={styles.note}>{t('search.card.reserved')}</span>}
          <span className={styles.meta}>
            {c.itemKind === 'game_account' ? t('search.card.game_account') : c.district}
            {c.distanceKm !== null && <> · {t('search.card.km', { km: toLocalDigits(String(c.distanceKm), lang) })}</>}
          </span>
        </span>
      </Link>
    </li>
  );
}

function AuctionLine({ a, t, lang }: { a: NonNullable<SearchCard['auction']>; t: T; lang: Lang }) {
  const now = useServerNow();
  const left = a.endAt ? formatCountdown(Date.parse(a.endAt) - now, lang) : null;
  return (
    <span className={styles.meta}>
      {t('search.card.auction')}
      {left && !left.ended && <> · {t('search.card.ends', { left: left.text })}</>}
      {' · '}{t('search.card.bids', { count: toLocalDigits(String(a.bidCount), lang) })}
      {!a.reserveMet && <> · {t('search.card.reserve_not_met')}</>}
    </span>
  );
}
