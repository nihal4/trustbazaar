// The TrustBazaar mark (docs/design/10_visual.md, section 5): a price tag pointing left with a peach hole and check,
// and the wordmark beside it. Inline SVG, so the header needs no request. Decorative: the link around it is named.
import styles from './shell.module.css';

export function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} viewBox="0 0 34 34" width="30" height="30" aria-hidden="true" focusable="false">
        <path d="M2.5 17 L11.5 5.5 H31.5 V28.5 H11.5 Z" fill={onDark ? '#FFFFFF' : '#1E1A26'} />
        <circle cx="11.8" cy="17" r="2.5" fill="#FFB59A" />
        <path d="M17.5 17.4 l3.2 3.2 l6.3 -7.2" fill="none" stroke={onDark ? '#4B2378' : '#FFB59A'} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={styles.wordmark} aria-hidden="true">trustbazaar</span>
    </span>
  );
}
