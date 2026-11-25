// The TrustBazaar mark (docs/design/10_visual_v3.md): a shopping bag whose handle is a padlock's shackle, on an ink tile:
// a marketplace that holds the money. Inline SVG, so the header needs no request. Decorative: the link around it is named.
import styles from './shell.module.css';

export function Logo({ onDark = false }: { onDark?: boolean }) {
  const tile = onDark ? '#FFFFFF' : '#0F1720';
  const bag = onDark ? '#0F1720' : '#FFFFFF';
  const hot = '#FF6B35';
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} viewBox="0 0 34 34" width="34" height="34" aria-hidden="true" focusable="false">
        <rect width="34" height="34" rx="10" fill={tile} />
        <path d="M12.2 13.6V11.4a4.800 4.800 0 0 1 9.600 0V13.6" fill="none" stroke={hot} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M8.6 13.6h16.8l1.4 11.6a2.3 2.3 0 0 1-2.3 2.6H9.500a2.3 2.3 0 0 1-2.3-2.6Z" fill={bag} />
        <circle cx="17" cy="20" r="1.9" fill={hot} />
        <path d="M17 21.2v3" stroke={hot} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className={styles.wordmark} aria-hidden="true"><span className={styles.wmA}>trust</span><span className={styles.wmB}>bazaar</span></span>
    </span>
  );
}
