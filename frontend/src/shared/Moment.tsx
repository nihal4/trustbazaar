// Times as ruled cells (U10-23), the look of the auction countdown: a big figure over a small unit, hairlines between the cells. TimeLeft is the time left as
// D | H | M (under a day H | M | S); DateCells is a date as day over month, time over AM/PM and year over weekday; Moment puts both side by side for a
// deadline. The cells are for the eye (aria-hidden); the real value for assistive technology is the visually hidden text from lib/time.js.
// Messages (any feature's catalogue that has them): time.unit_d/h/m/s, time.left, time.on, time.ended.
import { dateParts, formatCountdown, formatDateTime } from '../lib/time.js';
import { toLocalDigits } from '../lib/money.js';
import type { T } from './language/catalogue';
import type { Lang } from './language/lang';
import styles from './moment.module.css';

export function TimeLeft({ at, now, t, lang, label = true }: { at: number; now: number; t: T; lang: Lang; label?: boolean }) {
  const left = at - now;
  const c = formatCountdown(left, lang);
  const total = Math.max(0, Math.ceil(left / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const cells: [number, 'd' | 'h' | 'm' | 's'][] = d > 0 ? [[d, 'd'], [h, 'h'], [m, 'm']] : [[h, 'h'], [m, 'm'], [total % 60, 's']];
  return (
    <div className={styles.group}>
      {label && <span className={styles.k}>{t('time.left')}</span>}
      <span className={styles.visuallyHidden}>{c.text}</span>
      {c.ended
        ? <span className={`${styles.grid} ${styles.ended}`} aria-hidden="true"><span className={styles.cell}><strong>{t('time.ended')}</strong></span></span>
        : (
          <span className={c.urgent ? `${styles.grid} ${styles.urgent}` : styles.grid} aria-hidden="true">
            {cells.map(([n, u]) => (
              <span key={u} className={styles.cell}><strong>{toLocalDigits(String(n).padStart(u === 'd' ? 1 : 2, '0'), lang)}</strong><small>{t(`time.unit_${u}`)}</small></span>
            ))}
          </span>
        )}
    </div>
  );
}

export function DateCells({ at, t, lang, label = true, compact = false, inline = false, part }: { at: number; t: T; lang: Lang; label?: boolean; compact?: boolean; inline?: boolean; part?: 'day' | 'time' }) {
  const p = dateParts(at, lang);
  return (
    <div className={styles.group}>
      {label && <span className={styles.k}>{t('time.on')}</span>}
      <span className={styles.visuallyHidden}>{part === 'day' ? formatDateTime(at, lang).replace(/, .*$/, '') : formatDateTime(at, lang)}</span>
      <span className={[styles.grid, compact ? styles.compact : '', inline ? styles.inline : ''].filter(Boolean).join(' ')} aria-hidden="true">
        {part !== 'time' && <span className={styles.cell}><strong>{p.day}</strong><small>{p.month}</small></span>}
        {part !== 'day' && <span className={styles.cell}><strong>{p.time}</strong><small>{p.period}</small></span>}
        {part !== 'time' && <span className={styles.cell}><strong>{p.year}</strong><small>{p.weekday}</small></span>}
      </span>
    </div>
  );
}

/** A deadline: the time left, then the date it falls on. */
export function Moment({ at, now, t, lang }: { at: number; now: number; t: T; lang: Lang }) {
  return (
    <div className={styles.moment}>
      <TimeLeft at={at} now={now} t={t} lang={lang} />
      <DateCells at={at} t={t} lang={lang} />
    </div>
  );
}
