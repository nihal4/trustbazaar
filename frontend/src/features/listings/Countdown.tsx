// The time left as a small ruled grid of cells (2 D | 21 H | 10 M; under a day: H | M | S). The grid is for the eye (aria-hidden); the real value
// for assistive technology is the timer's own text (`text`, from lib/time.js), kept in a visually hidden element with role="timer".
import { toLocalDigits } from '../../lib/money.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from './listings.module.css';

export function Countdown({ left, text, urgent, t, lang }: { left: number; text: string; urgent: boolean; t: T; lang: Lang }) {
  const total = Math.max(0, Math.floor(left / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const cells: [number, 'd' | 'h' | 'm' | 's'][] = d > 0 ? [[d, 'd'], [h, 'h'], [m, 'm']] : [[h, 'h'], [m, 'm'], [sec, 's']];
  return (
    <>
      <span role="timer" aria-live="off" className={styles.visuallyHidden}>{text}</span>
      <span className={urgent ? `${styles.countGrid} ${styles.urgent}` : styles.countGrid} aria-hidden="true">
        {cells.map(([n, u]) => (
          <span key={u} className={styles.countCell}>
            <strong>{toLocalDigits(String(n).padStart(u === 'd' ? 1 : 2, '0'), lang)}</strong>
            <small>{t(`auction.unit_${u}`)}</small>
          </span>
        ))}
      </span>
    </>
  );
}
