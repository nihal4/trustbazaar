// The payment promise (Daylight design, docs/design/10_visual.md, section 6): a shield, a bold line and one sentence,
// on peach cream. Shown beside the price on the listing, at checkout and on the order; the words come from the page.
import styles from './promise.module.css';

export function PromiseNote({ title, text }: { title: string; text: string }) {
  return (
    <div className={styles.promise}>
      <svg viewBox="0 0 16 16" width="22" height="22" aria-hidden="true" focusable="false">
        <path d="M8 1 L14 3.2 V8 C14 11.6 11.4 14 8 15 C4.6 14 2 11.6 2 8 V3.2 Z" fill="currentColor" />
        <path d="M5.2 8 l2 2 l3.6 -4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p><strong>{title}</strong>{text}</p>
    </div>
  );
}
