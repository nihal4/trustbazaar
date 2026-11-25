// A listing in a grid (money-order design, docs/design/10_visual_v2.md, section 7, AC-HOME-2; FR-SRC-05; FR-MON-05):
// the photo on the second sheet, with the time left of an auction and "Featured" in words as small boxes on it; then
// the price in tabular figures, the title, and the details in words. A photo that does not load leaves the sheet,
// never a broken image.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { formatCountdown } from '../../lib/time.js';
import { useServerNow } from '../../shared/clock';
import type { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import type { SearchCard } from './SearchPage';
import styles from './card.module.css';

type T = ReturnType<typeof useT>['t'];

export function ListingCard({ c, t, lang }: { c: SearchCard; t: T; lang: Lang }) {
  const [broken, setBroken] = useState(false);
  const details = [
    c.itemKind === 'game_account' ? t('search.card.game_account') : c.district,
    c.distanceKm !== null ? t('search.card.km', { km: toLocalDigits(String(c.distanceKm), lang) }) : null,
  ].filter(Boolean).join(', ');
  return (
    <li className={styles.card}>
      <Link to={`/listings/${encodeURIComponent(c.id)}`} className={styles.link}>
        <span className={styles.photo}>
          {(!c.thumbUrl || broken) && (
            <svg className={styles.noPhoto} viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false"><path d="M4 7.5 12 3l8 4.500v9L12 21l-8-4.500Z M4 7.500 12 12l8-4.500 M12 12v9" fill="none" stroke="currentColor" strokeWidth="1.500" strokeLinejoin="round" /></svg>
          )}
          {c.thumbUrl && !broken && <img src={c.thumbUrl} alt="" width={400} height={400} loading="lazy" onError={() => setBroken(true)} />}
          {c.auction && <TimeLeft endAt={c.auction.endAt} t={t} lang={lang} />}
          {c.featured && <span className={styles.featured}>{t('search.card.featured')}</span>}
        </span>
        <span className={styles.price}>{formatMoney(c.price, lang)}</span>
        <span className={styles.title}>{c.title}</span>
        {c.auction && (
          <span className={styles.meta}>
            {[t('search.card.auction'), (c.auction.bidCount === 1 ? t('search.card.bid_one') : t('search.card.bids', { count: toLocalDigits(String(c.auction.bidCount), lang) })),
              !c.auction.reserveMet ? t('search.card.reserve_not_met') : null].filter(Boolean).join(', ')}
          </span>
        )}
        {details && <span className={styles.meta}>{details}</span>}
        {c.currentlyReserved && <span className={styles.note}>{t('search.card.reserved')}</span>}
      </Link>
    </li>
  );
}

/** "Ends in …" on the photo, on the server's clock; marked in words and colour in the last hour. */
function TimeLeft({ endAt, t, lang }: { endAt: string | null; t: T; lang: Lang }) {
  const now = useServerNow();
  if (!endAt) return null;
  const ms = Date.parse(endAt) - now;
  const left = formatCountdown(ms, lang);
  if (left.ended) return null;
  return (
    <span className={ms <= 3_600_000 ? `${styles.clock} ${styles.soon}` : styles.clock}>
      <i aria-hidden="true" />{t('search.card.ends', { left: left.text })}
    </span>
  );
}
