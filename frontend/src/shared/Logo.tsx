// The TrustBazaar mark (docs/design/10_visual_v3.md): an ink tile with a shield and a tick, and the wordmark
// beside it. Inline SVG, so the header needs no request. Decorative: the link around it is named.
import styles from './shell.module.css';

export function Logo({ onDark = false }: { onDark?: boolean }) {
  const tile = onDark ? '#A1FFCB' : '#232323';
  const ink = onDark ? '#232323' : '#A1FFCB';
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} viewBox="0 0 34 34" width="32" height="32" aria-hidden="true" focusable="false">
        <rect width="34" height="34" rx="10" fill={tile} />
        <path d="M17 6.5 8.8 9.7v6.3c0 5.1 3.4 9.1 8.2 10.8 4.8-1.7 8.2-5.7 8.2-10.8V9.7Z" fill="none" stroke={ink} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="m13.2 16.4 2.800 2.800 5-5.300" fill="none" stroke={ink} strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={styles.wordmark} aria-hidden="true">trustbazaar</span>
    </span>
  );
}
