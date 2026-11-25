// The loading screen of a language change (docs/design/10_visual_v3.md, section 9): a full-page skeleton of the site's own
// layout, shimmering blocks with no text and no images, shown while the new language is rendered underneath and its fonts
// load, then faded out, so the change of typeface is never seen. Decorative: the page is marked busy while it shows.
import styles from './skeleton.module.css';

export function LanguageSkeleton({ leaving }: { leaving: boolean }) {
  return (
    <div className={leaving ? `${styles.sk} ${styles.leaving}` : styles.sk} aria-hidden="true">
      <div className={styles.promise}><i /></div>
      <div className={styles.header}><i className={styles.logo} /><span /><i className={styles.btn} /><i className={styles.btn} /><i className={`${styles.btn} ${styles.sell}`} /></div>
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className={styles.heroText}><i className={styles.h1} /><i className={styles.h1} /><i className={`${styles.h1} ${styles.short}`} /><i className={styles.lede} /><i className={`${styles.lede} ${styles.short}`} /><i className={styles.bar} /></div>
          <div className={styles.window}><i className={styles.photo} /><div className={styles.winBody}><i className={styles.line} /><i className={`${styles.line} ${styles.short}`} /><i className={styles.price} /></div></div>
        </div>
        <div className={styles.strip}>{[0, 1, 2, 3, 4, 5].map((n) => <i key={n} />)}</div>
        <i className={styles.title} />
        <div className={styles.cells}>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className={styles.cell}><i className={styles.thumb} /><i className={styles.line} /><i className={`${styles.line} ${styles.short}`} /></div>
          ))}
        </div>
      </div>
    </div>
  );
}
