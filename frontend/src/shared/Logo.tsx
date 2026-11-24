// The TrustBazaar mark (docs/design/10_visual_v2.md, section 5): a money-order counterfoil, the stub torn along its
// perforation and the form postmarked with a tick, and the wordmark beside it. Inline SVG, so the header needs no
// request. Decorative: the link around it is named.
import styles from './shell.module.css';

const PERFORATION = [9.5, 12.5, 15.5, 18.5, 21.5, 24.5];

export function Logo({ onDark = false }: { onDark?: boolean }) {
  const form = onDark ? '#FFFFFF' : '#06525C';
  const paper = onDark ? '#0D2326' : '#F7F9F8';
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} viewBox="0 0 34 34" width="30" height="30" aria-hidden="true" focusable="false">
        <rect x="2" y="7" width="30" height="20" rx="2" fill={form} />
        {PERFORATION.map((y) => <circle key={y} cx="11" cy={y} r="0.95" fill={paper} />)}
        <circle cx="21.5" cy="17" r="5.6" fill="none" stroke={paper} strokeWidth="1.5" />
        <path d="M19 17.2 l1.8 1.8 l3.4 -3.8" fill="none" stroke={paper} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={styles.wordmark} aria-hidden="true">trustbazaar</span>
    </span>
  );
}
