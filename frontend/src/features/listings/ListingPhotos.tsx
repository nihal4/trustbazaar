// The photo gallery of a listing: the main photo and the others as a strip.
import { useEffect, useState, type PointerEvent } from 'react';
import { toLocalDigits } from '../../lib/money.js';
import type { Lang } from '../../shared/language/lang';
import { type ListingView } from './model';
import styles from './listings.module.css';
import { T } from './listingShared';

/** One large photo with a row of small ones under it; pressing a small one shows it in the large place (every kind of item).
 *  Physical items also get a magnifying glass: with a mouse, hovering the large photo shows it enlarged under the pointer
 *  (a game account has no object to inspect, so none). The large photo is the 1600 px file with the 400 px thumbnail as a
 *  smaller alternative; the small ones are asked for only once it has arrived (or after three seconds), so nothing shares
 *  the network with the page's largest paint (NFR-PERF-07; Decisions log, U10-10). */
export function Photos({ l, t, lang }: { l: ListingView; t: T; lang: Lang }) {
  const [rest, setRest] = useState(false);
  const [at, setAt] = useState(0);
  const [glass, setGlass] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setRest(true), 3000);
    return () => window.clearTimeout(timer);
  }, []);
  if (l.photos.length === 0) return null;
  const total = toLocalDigits(String(l.photos.length), lang);
  const p = l.photos[Math.min(at, l.photos.length - 1)];
  const magnify = l.itemKind === 'physical';
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!magnify || e.pointerType === 'touch' || e.pointerType === 'pen') return;
    const r = e.currentTarget.getBoundingClientRect();
    setGlass({ x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) });
  };
  return (
    <section aria-labelledby="photos-title">
      <h2 id="photos-title" className={styles.visuallyHidden}>
        {t('listing.photos')}
      </h2>
      <div
        className={magnify ? `${styles.stage} ${styles.canZoom}` : styles.stage}
        style={{ aspectRatio: `${p.width} / ${p.height}` }}
        onPointerMove={move}
        onPointerLeave={() => setGlass(null)}
      >
        <img
          key={p.id}
          src={p.url}
          srcSet={`${p.thumbUrl} 400w, ${p.url} 1600w`}
          sizes="(min-width: 60rem) 40rem, 100vw"
          width={p.width}
          height={p.height}
          alt={t('listing.photo_alt', { title: l.title, n: toLocalDigits(String(at + 1), lang), total })}
          loading="eager"
          {...{ fetchpriority: 'high' }}
          onLoad={() => setRest(true)}
          onError={() => setRest(true)}
        />
        {p.showsDefects && <span className={styles.badge}>{t('listing.shows_defects')}</span>}
        {magnify && glass && (
          <span className={styles.glass} aria-hidden="true" style={{ backgroundImage: `url("${p.url}")`, backgroundPosition: `${glass.x}% ${glass.y}%` }} />
        )}
      </div>
      {l.photos.length > 1 && (
        <ul className={styles.thumbs}>
          {l.photos.map((q, i) => (
            <li key={q.id}>
              <button
                type="button"
                className={i === at ? `${styles.thumb} ${styles.thumbOn}` : styles.thumb}
                aria-pressed={i === at}
                aria-label={t('listing.show_photo', { n: toLocalDigits(String(i + 1), lang), total })}
                onClick={() => setAt(i)}
              >
                <img {...(rest || i === at ? { src: q.thumbUrl } : {})} alt="" width={q.width} height={q.height} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
