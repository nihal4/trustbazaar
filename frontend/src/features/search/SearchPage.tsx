// Search (docs/design/08_frontend.pdf section 7.3; IF-UI-03; FR-SRC-01 to FR-SRC-05; U8-04; Daylight design,
// docs/design/10_visual.md, section 7.2: the words on top, the filters in a column beside the results on wide screens
// and behind a "Show filters" button on phones, the active filters as removable chips). The filters
// live in the URL, so a search can be shared and the back button works; pages are added with "Show more" rather
// than endless scrolling, so the footer stays reachable. Distances come from the server in whole kilometres. The
// location is asked for only when "Use my location" is pressed (I-58); signed-in users otherwise search from the
// area saved in their account (Unit 3). The area list arrives with Unit 4's /delivery/areas (U4-02).
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@mantine/core';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { formatMoney, parseTaka } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { Dropdown } from '../../shared/Dropdown';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { useMe } from '../../shared/me';
import { problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import en from '../../messages/en/search.json';
import bn from '../../messages/bn/search.json';
import { ListingCard } from './ListingCard';
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

  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('search.title')}</h1>
      <p className={styles.lead}>{t('search.lead')}</p>
      <Filters key={key} t={t} lang={lang} params={query} categories={categories.data ?? []} signedIn={me.isSuccess}
        onSearch={(next) => setParams(next)} />
      <ActiveFilters t={t} lang={lang} params={query} categories={categories.data ?? []} onChange={(next) => setParams(next)} />
      {pages.isPending && (
        <div className={styles.status}>
          <p role="status" className={styles.visuallyHidden}>{t('shell.loading')}</p>
          <ul className={styles.cards} aria-hidden="true">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <li key={n} className={styles.skeleton}><i /><i /><i /></li>)}
          </ul>
        </div>
      )}
      {pages.isError && (
        <div className={styles.status}>
          <FormMessage kind="error">
            {problemName(pages.error) === 'validation-failed' && (query.get('sort') === 'distance' || query.has('maxKm'))
              ? t('search.needs_point') : errorText(pages.error, t, lang)}
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
                {pages.data.pages[0].featured.map((c) => <ListingCard key={c.id} c={c} t={t} lang={lang} />)}
              </ul>
            </section>
          )}
          <section aria-labelledby="results-title">
            <h2 id="results-title">{t('search.results')}</h2>
            {items.length === 0
              ? <p className={styles.empty}>{t('search.empty')}</p>
              : <ul className={styles.cards}>{items.map((c) => <ListingCard key={c.id} c={c} t={t} lang={lang} />)}</ul>}
            {pages.hasNextPage && (
              <div className={styles.moreRow}>
                <Button variant="default" loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>{t('search.more')}</Button>
              </div>
            )}
          </section>
        </div>
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
  const [open, setOpen] = useState(false);
  const set = (k: keyof typeof v) => (value: string) => setV((x) => ({ ...x, [k]: value }));
  // on phones the open filters are a sheet over the page: the page behind does not scroll, and Escape closes it
  useEffect(() => {
    if (!open) return undefined;
    document.documentElement.dataset.sheet = 'open';
    return () => { delete document.documentElement.dataset.sheet; };
  }, [open]);

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
    <form role="search" className={styles.filters} onSubmit={submit} noValidate onKeyDown={(e) => { if (e.key === 'Escape' && open) setOpen(false); }}>
      <div className={styles.words}>
        <label htmlFor="search-q" className={styles.wordsLabel}>{t('search.words')}</label>
        <input id="search-q" type="search" value={v.q} maxLength={100} placeholder={t('home.search_placeholder')} onChange={(e) => set('q')(e.target.value)} />
        <button type="submit" className={styles.submit}>{t('search.submit')}</button>
      </div>
      {message && <div className={styles.msg}><FormMessage kind="error">{message}</FormMessage></div>}
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls="search-filters" onClick={() => setOpen((o) => !o)}>
        {open ? t('search.hide_filters') : t('search.show_filters')}
      </button>
      {open && <button type="button" className={styles.backdrop} aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />}
      <fieldset id="search-filters" className={open ? `${styles.grid} ${styles.open}` : styles.grid}>
        <legend>{t('search.filters')}</legend>
        <button type="button" className={styles.sheetClose} aria-label={t('shell.close')} onClick={() => setOpen(false)}>×</button>
        <Select id="search-category" label={t('search.category')} value={v.category} onChange={set('category')} any={t('search.any')}
          options={categoryTree(categories).filter(({ c }) => c.selectable).map(({ c, depth }) => [String(c.id), `${'\u00a0'.repeat(depth * 2)}${name(c)}`])} />
        <Select id="search-kind" label={t('search.item_kind')} value={v.itemKind} onChange={set('itemKind')} any={t('search.any')}
          options={(['physical', 'game_account'] as const).map((k) => [k, t(`search.item_kind.${k}`)])} />
        <Select id="search-format" label={t('search.sale_format')} value={v.saleFormat} onChange={set('saleFormat')} any={t('search.any')}
          options={(['fixed_price', 'auction'] as const).map((k) => [k, t(`search.sale_format.${k}`)])} />
        <Select id="search-condition" label={t('search.condition')} value={v.condition} onChange={set('condition')} any={t('search.any')}
          options={CONDITIONS.map((k) => [k, t(`search.condition.${k}`)])} />
        <div className={styles.pair}>
          <Text id="search-min" label={t('search.min_price')} value={v.minPrice} onChange={set('minPrice')} placeholder={t('search.any')} />
          <Text id="search-max" label={t('search.max_price')} value={v.maxPrice} onChange={set('maxPrice')} placeholder={t('search.any')} />
        </div>
        <Text id="search-km" label={t('search.max_km')} value={v.maxKm} onChange={set('maxKm')} placeholder={t('search.any')} />
        <Select id="search-sort" label={t('search.sort')} value={v.sort} onChange={set('sort')} any={t(v.q.trim() ? 'search.sort.relevance' : 'search.sort.newest')}
          options={SORTS.map((k) => [k, t(`search.sort.${k}`)])} />
        <div className={styles.location}>
          {point
            ? (
              <>
                <p>{t('search.location_set')}</p>
                <button type="button" className={styles.secondary} onClick={() => { setPoint(null); submit(undefined, null); }}>{t('search.clear_location')}</button>
              </>
            )
            : (
              <>
                {signedIn && <p className={styles.hint}>{t('search.location_saved')}</p>}
                <button type="button" className={styles.secondary} onClick={locate} disabled={locating}>{locating ? t('search.locating') : t('search.use_location')}</button>
              </>
            )}
        </div>
        <button type="submit" className={styles.apply}>{t('search.apply')}</button>
      </fieldset>
    </form>
  );
}

/** The filters in force, as chips that remove one each, and "Clear all" (the words stay). */
function ActiveFilters({ t, lang, params, categories, onChange }: {
  t: T; lang: Lang; params: URLSearchParams; categories: Category[]; onChange: (next: URLSearchParams) => void;
}) {
  const label = (k: string, v: string): string | null => {
    switch (k) {
      case 'category': { const c = categories.find((x) => String(x.id) === v); return c ? (lang === 'bn' ? c.nameBn : c.nameEn) : null; }
      case 'itemKind': return t(`search.item_kind.${v}`);
      case 'saleFormat': return t(`search.sale_format.${v}`);
      case 'condition': return t(`search.condition.${v}`);
      case 'minPrice': return t('search.chip.min', { amount: formatMoney(v, lang) });
      case 'maxPrice': return t('search.chip.max', { amount: formatMoney(v, lang) });
      case 'maxKm': return t('search.card.km', { km: v });
      default: return null;
    }
  };
  const chips = (['category', 'itemKind', 'saleFormat', 'condition', 'minPrice', 'maxPrice', 'maxKm'] as const)
    .map((k) => ({ k, text: params.get(k) ? label(k, params.get(k)!) : null }))
    .filter((c): c is { k: typeof c.k; text: string } => c.text !== null);
  if (chips.length === 0) return null;
  const without = (keys: string[]) => {
    const next = new URLSearchParams(params);
    for (const k of keys) next.delete(k);
    return next;
  };
  return (
    <div className={styles.chips} role="group" aria-label={t('search.active')}>
      {chips.map(({ k, text }) => (
        <button key={k} type="button" className={styles.chip} onClick={() => onChange(without([k]))}>
          <span className={styles.visuallyHidden}>{t('search.remove')} </span>{text}<span aria-hidden="true" className={styles.x}>×</span>
        </button>
      ))}
      <button type="button" className={styles.clear} onClick={() => onChange(without(chips.map((c) => c.k)))}>{t('search.clear_all')}</button>
    </div>
  );
}

const toAscii = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();

function Select({ id, label, value, onChange, options, any }: {
  id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][]; any: string;
}) {
  return (
    <div className={styles.field}>
      <Dropdown id={id} label={label} value={value} onChange={onChange} options={options} any={any} />
    </div>
  );
}

function Text({ id, label, value, onChange, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" inputMode="decimal" value={value} maxLength={20} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
