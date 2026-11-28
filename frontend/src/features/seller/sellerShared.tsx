// What the seller dashboard's parts share: how a time is written and what a refused list says.
import { dateParts, formatCountdown } from '../../lib/time.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { errorText } from '../../shared/errors';
import { isApiError } from '../../shared/problems';
import styles from './seller.module.css';

/** A time as "30 Nov 2026, 9:47 PM" in Dhaka time (the weekday is left out: the date says the day). */
export function shortWhen(ms: number, lang: Lang): string {
  const p = dateParts(ms, lang);
  return `${p.day} ${p.month} ${p.year}, ${p.time} ${p.period}`;
}

const remaining = (text: string, lang: Lang) => (lang === 'bn' ? `আর ${text}` : `in ${text}`);

/** A deadline in ruled lines: the date, the time, and what is left, right-aligned and in tabular figures (NFR-USE-08: the date, and the countdown). */
export function When({ ms, now, lang, left = false }: { ms: number; now: number; lang: Lang; left?: boolean }) {
  const p = dateParts(ms, lang);
  const c = formatCountdown(ms - now, lang);
  return (
    <div className={styles.when}>
      <span className={styles.whenDate}>
        {p.day} {p.month} {p.year}
      </span>
      <span className={styles.whenTime}>
        {p.weekday}, {p.time} {p.period}
      </span>
      {left && (
        <span className={c.urgent || c.ended ? `${styles.whenLeft} ${styles.whenUrgent}` : styles.whenLeft}>{c.ended ? c.text : remaining(c.text, lang)}</span>
      )}
    </div>
  );
}
export const listingsError = (e: unknown, t: T, lang: Lang) => (isApiError(e, 403) ? t('seller.verify') : errorText(e, t, lang));
