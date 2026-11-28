// The chips of the filters that are on, each of which removes its filter, and the button that clears them all.
import { formatMoney } from '../../lib/money.js';
import type { Lang } from '../../shared/language/lang';
import styles from './search.module.css';
import { Cross, Category, T } from './searchShared';

/** The filters in force, as chips that remove one each, and "Clear all" (the words stay). */
export function ActiveFilters({
  t,
  lang,
  params,
  categories,
  onChange,
}: {
  t: T;
  lang: Lang;
  params: URLSearchParams;
  categories: Category[];
  onChange: (next: URLSearchParams) => void;
}) {
  const label = (k: string, v: string): string | null => {
    switch (k) {
      case 'category': {
        const c = categories.find((x) => String(x.id) === v);
        if (!c) return null;
        return lang === 'bn' ? c.nameBn : c.nameEn;
      }
      case 'itemKind':
        return t(`search.item_kind.${v}`);
      case 'saleFormat':
        return t(`search.sale_format.${v}`);
      case 'condition':
        return t(`search.condition.${v}`);
      case 'minPrice':
        return t('search.chip.min', { amount: formatMoney(v, lang) });
      case 'maxPrice':
        return t('search.chip.max', { amount: formatMoney(v, lang) });
      case 'maxKm':
        return t('search.card.km', { km: v });
      default:
        return null;
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
          <span className={styles.visuallyHidden}>{t('search.remove')} </span>
          {text}
          <span aria-hidden="true" className={styles.x}>
            <Cross size={10} />
          </span>
        </button>
      ))}
      <button type="button" className={styles.clear} onClick={() => onChange(without(chips.map((c) => c.k)))}>
        {t('search.clear_all')}
      </button>
    </div>
  );
}
