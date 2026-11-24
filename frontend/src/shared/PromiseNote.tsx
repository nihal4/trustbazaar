// The payment promise (docs/design/10_visual_v2.md, section 6): a counterfoil strip, its stub postmarked with a tick,
// a bold line and one sentence. Shown beside the price on the listing, at checkout and on the order; the words come
// from the page.
import styles from './promise.module.css';

export function PromiseNote({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.promise}>
      <span className={styles.mark} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
          <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="6.8" fill="none" stroke="currentColor" strokeWidth="0.9" strokeDasharray="1.6 1.4" />
          <path d="M8.6 12.3 l2.4 2.4 l4.6 -5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <p><strong>{title}</strong>{text}</p>
    </div>
  );
}
