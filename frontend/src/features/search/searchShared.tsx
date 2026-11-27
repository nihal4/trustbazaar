import { Dropdown } from '../../shared/Dropdown';
import { useT } from '../../shared/language/Language';
import styles from './search.module.css';

/** a drawn cross, not a text glyph (craft floor); the colour is the parent's */
export const Cross = ({ size }: { size: number }) => (
  <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden="true" focusable="false">
    <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const SearchGlyph = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
    <path d="M11 4 a7 7 0 1 0 0.01 0 Z M16.5 16.5 L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export interface Category {
  id: number;
  parentId: number | null;
  slug: string;
  nameEn: string;
  nameBn: string;
  itemKind: string;
  selectable: boolean;
}

/** The parameters GET /search takes, in the page's URL under the same names (Decisions log, U3-03). */
export const PARAMS = ['q', 'category', 'itemKind', 'saleFormat', 'condition', 'minPrice', 'maxPrice', 'maxKm', 'lat', 'lng', 'sort'] as const;

export const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'distance', 'ending_soon'] as const;

export const CONDITIONS = ['new', 'like_new', 'used', 'for_parts'] as const;

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

export const taka = (poisha: string | null) => (poisha ? String(Number(BigInt(poisha) / 100n)) : '');

export type T = ReturnType<typeof useT>['t'];

export const toAscii = (s: string) => s.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).trim();

export function Select({
  id,
  label,
  value,
  onChange,
  options,
  any,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  any: string;
}) {
  return (
    <div className={styles.field}>
      <Dropdown id={id} label={label} value={value} onChange={onChange} options={options} any={any} />
    </div>
  );
}

export function Text({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" inputMode="decimal" value={value} maxLength={20} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
