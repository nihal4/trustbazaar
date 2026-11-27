// The filters of the search page: category, condition, price, place and sort, in the sheet on a phone and beside the results on a desktop.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseTaka } from '../../lib/money.js';
import { FormMessage } from '../../shared/form';
import type { Lang } from '../../shared/language/lang';
import styles from './search.module.css';
import { Button } from '../../shared/ui';
import { useSheet } from './useSheet';
import { Cross, SearchGlyph, Category, PARAMS, SORTS, CONDITIONS, categoryTree, taka, T, toAscii, Select, Text } from './searchShared';

export function Filters({
  t,
  lang,
  params,
  categories,
  signedIn,
  onSearch,
}: {
  t: T;
  lang: Lang;
  params: URLSearchParams;
  categories: Category[];
  signedIn: boolean;
  onSearch: (next: URLSearchParams) => void;
}) {
  const [v, setV] = useState(() => ({
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    itemKind: params.get('itemKind') ?? '',
    saleFormat: params.get('saleFormat') ?? '',
    condition: params.get('condition') ?? '',
    minPrice: taka(params.get('minPrice')),
    maxPrice: taka(params.get('maxPrice')),
    maxKm: params.get('maxKm') ?? '',
    sort: params.get('sort') ?? '',
  }));
  const [point, setPoint] = useState(() => (params.get('lat') && params.get('lng') ? { lat: params.get('lat')!, lng: params.get('lng')! } : null));
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const sheet = useSheet();
  const modal = open && sheet;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLFieldSetElement>(null);
  const set = (k: keyof typeof v) => (value: string) => setV((x) => ({ ...x, [k]: value }));
  // On phones the open filters are a sheet over the page, so they behave as a modal dialog: focus moves into the sheet, Tab stays
  // inside it, Escape closes it from anywhere, the page behind does not scroll, and focus returns to the "Show filters" row.
  useEffect(() => {
    if (!modal) return undefined;
    document.documentElement.dataset.sheet = 'open';
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [
        ...panelRef.current.querySelectorAll<HTMLElement>('button, input, select, [role="combobox"], a[href], [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!panelRef.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', key);
    const toggle = toggleRef.current;
    return () => {
      document.removeEventListener('keydown', key);
      delete document.documentElement.dataset.sheet;
      toggle?.focus();
    };
  }, [modal]);

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
    <form
      role="search"
      className={styles.filters}
      onSubmit={submit}
      noValidate
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open && !sheet) setOpen(false);
      }}
    >
      <div className={styles.words}>
        <label htmlFor="search-q" className={styles.wordsLabel}>
          {t('search.words')}
        </label>
        <span className={styles.wordsIcon}>
          <SearchGlyph />
        </span>
        <input id="search-q" type="search" value={v.q} maxLength={100} placeholder={t('home.search_placeholder')} onChange={(e) => set('q')(e.target.value)} />
        <button type="submit" className={styles.submit}>
          {t('search.submit')}
        </button>
      </div>
      {message && (
        <div className={styles.msg}>
          <FormMessage kind="error">{message}</FormMessage>
        </div>
      )}
      <button type="button" ref={toggleRef} className={styles.toggle} aria-expanded={open} aria-controls="search-filters" onClick={() => setOpen((o) => !o)}>
        {open ? t('search.hide_filters') : t('search.show_filters')}
      </button>
      {open && <button type="button" className={styles.backdrop} aria-hidden="true" tabIndex={-1} onClick={() => setOpen(false)} />}
      <fieldset
        id="search-filters"
        ref={panelRef}
        className={open ? `${styles.grid} ${styles.open}` : styles.grid}
        role={modal ? 'dialog' : undefined}
        aria-modal={modal ? true : undefined}
        aria-labelledby={modal ? 'search-filters-title' : undefined}
      >
        <legend id="search-filters-title">{t('search.filters')}</legend>
        <button type="button" ref={closeRef} className={styles.sheetClose} aria-label={t('shell.close')} onClick={() => setOpen(false)}>
          <Cross size={18} />
        </button>
        <Select
          id="search-category"
          label={t('search.category')}
          value={v.category}
          onChange={set('category')}
          any={t('search.any')}
          options={categoryTree(categories)
            .filter(({ c }) => c.selectable)
            .map(({ c, depth }) => [String(c.id), `${'\u00a0'.repeat(depth * 2)}${name(c)}`])}
        />
        <Select
          id="search-kind"
          label={t('search.item_kind')}
          value={v.itemKind}
          onChange={set('itemKind')}
          any={t('search.any')}
          options={(['physical', 'game_account'] as const).map((k) => [k, t(`search.item_kind.${k}`)])}
        />
        <Select
          id="search-format"
          label={t('search.sale_format')}
          value={v.saleFormat}
          onChange={set('saleFormat')}
          any={t('search.any')}
          options={(['fixed_price', 'auction'] as const).map((k) => [k, t(`search.sale_format.${k}`)])}
        />
        <Select
          id="search-condition"
          label={t('search.condition')}
          value={v.condition}
          onChange={set('condition')}
          any={t('search.any')}
          options={CONDITIONS.map((k) => [k, t(`search.condition.${k}`)])}
        />
        <div className={styles.pair}>
          <Text id="search-min" label={t('search.min_price')} value={v.minPrice} onChange={set('minPrice')} placeholder={t('search.any')} />
          <Text id="search-max" label={t('search.max_price')} value={v.maxPrice} onChange={set('maxPrice')} placeholder={t('search.any')} />
        </div>
        <Text id="search-km" label={t('search.max_km')} value={v.maxKm} onChange={set('maxKm')} placeholder={t('search.any')} />
        <Select
          id="search-sort"
          label={t('search.sort')}
          value={v.sort}
          onChange={set('sort')}
          any={t(v.q.trim() ? 'search.sort.relevance' : 'search.sort.newest')}
          options={SORTS.map((k) => [k, t(`search.sort.${k}`)])}
        />
        <div className={styles.location}>
          {point ? (
            <>
              <p>{t('search.location_set')}</p>
              <Button
                variant="link"
                type="button"
                onClick={() => {
                  setPoint(null);
                  submit(undefined, null);
                }}
              >
                {t('search.clear_location')}
              </Button>
            </>
          ) : (
            <>
              {signedIn && <p className={styles.hint}>{t('search.location_saved')}</p>}
              <Button variant="link" type="button" onClick={locate} disabled={locating}>
                {locating ? t('search.locating') : t('search.use_location')}
              </Button>
            </>
          )}
        </div>
        <button type="submit" className={styles.apply}>
          {t('search.apply')}
        </button>
      </fieldset>
    </form>
  );
}
