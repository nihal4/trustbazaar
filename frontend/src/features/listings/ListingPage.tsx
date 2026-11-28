// The listing page (docs/design/08_frontend.pdf sections 3.3 and 7.3; IF-UI-03; U8-04; money-order world,
// docs/design/10_visual_v2.md, AC-LST: photos first and large; beside them the counterfoil, which holds the price,
// how the money moves and the buy button, or the auction panel with the payment promise; then the seller; on phones
// one column). It renders from one request,
// GET /listings/{id}, which includes the auction state (section 9). Everything the seller wrote is shown as text
// (SEC-INP-03); the location is the district only (FR-LST-06). A fixed-price item links to its checkout (U8-05);
// an auction shows its panel. Others see only public listings; the seller sees their own in every state.
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { useMe } from '../../shared/me';

import { Tick } from '../../shared/icons';
import { AuctionPanel } from './AuctionPanel';
import { TitleParts } from './TitleParts';
import type { ListingView } from './model';
import en from '../../messages/en/listings.json';
import bn from '../../messages/bn/listings.json';
import { ListingFailed, useListing } from './useListing';
import styles from './listings.module.css';
import { Avatar } from '../../shared/ui';
import { Photos } from './ListingPhotos';
import { T } from './listingShared';
import { Details } from './ListingDetails';
import { MessageSeller } from './ListingMessageSeller';

const CATALOGUES = { en, bn };

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const me = useMe();
  const { pathname } = useLocation();
  const listing = useListing(id);

  // On wide screens the right column stays in view down to the footer, so the footer makes room beside it (shell.module.css reads
  // html[data-rail] and --tb-rail-reserve) instead of covering it or pushing it up.
  const rail = useRef<HTMLDivElement>(null);
  const [extraHost, setExtraHost] = useState<HTMLElement | null>(null);
  const ready = listing.isSuccess && listing.data.saleFormat !== 'auction';
  useEffect(() => {
    const el = rail.current;
    if (!ready || !el || typeof ResizeObserver === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const root = document.documentElement;
    const wide = window.matchMedia('(min-width: 60rem) and (min-height: 46rem)');
    const apply = () => {
      if (wide.matches) {
        root.dataset.rail = 'on';
        root.style.setProperty('--tb-rail-reserve', `${Math.round(el.getBoundingClientRect().width + 40)}px`);
      } else {
        delete root.dataset.rail;
        root.style.removeProperty('--tb-rail-reserve');
      }
    };
    apply();
    const watch = new ResizeObserver(apply);
    watch.observe(el);
    wide.addEventListener('change', apply);
    return () => {
      watch.disconnect();
      wide.removeEventListener('change', apply);
      delete root.dataset.rail;
      root.style.removeProperty('--tb-rail-reserve');
    };
  }, [ready]);

  if (listing.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (listing.isError) {
    return <ListingFailed error={listing.error} t={t} lang={lang} />;
  }
  const l = listing.data;
  const own = me.data?.id === l.seller.id;
  const signedIn = me.isSuccess;
  const category = lang === 'bn' ? l.category.nameBn : l.category.nameEn;
  return (
    <article className={[styles.page, l.photos.length > 0 ? '' : styles.noPhotos, l.saleFormat === 'auction' ? styles.flow : ''].filter(Boolean).join(' ')}>
      <div className={styles.gallery}>
        <Photos l={l} t={t} lang={lang} />
      </div>
      {/* the right-hand column on wide screens (title, price, buy, seller) is one block that stays in view while the photos and the description scroll */}
      <div className={styles.rail} ref={rail}>
        <header className={styles.head}>
          <p className={styles.crumb}>
            <Link to={`/search?category=${l.category.id}`}>{category}</Link>
            {l.itemKind === 'game_account' && <span className={styles.kind}>{t('listing.game_account')}</span>}
          </p>
          <h1 className={styles.title}>
            <TitleParts text={l.title} />
          </h1>
          <Status l={l} own={own} t={t} />
          {l.itemKind === 'game_account' && (
            <section aria-labelledby="game-risk-title" className={styles.risk}>
              <h2 id="game-risk-title">{t('listing.game_risk_title')}</h2>
              {[1, 2, 3].map((n) => (
                <p key={n}>{t(`listing.game_risk.${n}`)}</p>
              ))}
            </section>
          )}
        </header>
        <aside className={styles.side}>
          {l.saleFormat === 'auction' && l.auction ? (
            <>
              <AuctionPanel initial={l.auction} t={t} lang={lang} signedIn={signedIn} own={own} nextPath={pathname} extraHost={extraHost} />
              {l.auction.status === 'open' && (
                <p className={styles.promise}>
                  <Shield />
                  {t('listing.promise.text')}
                </p>
              )}
            </>
          ) : (
            <Buy l={l} own={own} t={t} lang={lang} />
          )}
          <section aria-labelledby="seller-title" className={styles.seller}>
            <h2 id="seller-title" className={styles.visuallyHidden}>
              {t('listing.seller')}
            </h2>
            <div className={l.seller.pro === true || l.seller.ratingCount ? `${styles.sellerRow} ${styles.sellerRowRated}` : styles.sellerRow}>
              <Avatar size="md" name={l.seller.displayName} className={styles.sellerAvatar} />
              <div className={styles.sellerInfo}>
                <p className={styles.sellerLine}>
                  <Link className={styles.sellerName} to={`/users/${encodeURIComponent(l.seller.id)}`}>
                    {l.seller.displayName}
                  </Link>
                  {l.seller.verified && (
                    <span className={styles.tick} title={t('listing.seller_verified')}>
                      <Tick />
                      <span className={styles.visuallyHidden}>{t('listing.seller_verified')}</span>
                    </span>
                  )}
                </p>
                <p className={styles.sellerMeta}>{t('listing.seller_since', { year: toLocalDigits(l.seller.joinMonth.slice(0, 4), lang) })}</p>
              </div>
              {l.seller.pro === true || l.seller.ratingCount ? (
                <div className={styles.sellerRating}>
                  {l.seller.ratingCount ? <Stars average={l.seller.ratingAverage ?? 0} count={l.seller.ratingCount} t={t} lang={lang} /> : null}
                  {l.seller.pro === true && <span className={styles.pro}>{t('listing.seller_pro')}</span>}
                </div>
              ) : null}
              {!own && ['active', 'sold', 'ended_unsold'].includes(l.status) && (
                <MessageSeller listingId={l.id} signedIn={signedIn} nextPath={pathname} t={t} lang={lang} />
              )}
            </div>
          </section>
        </aside>
      </div>
      <div className={styles.body}>
        <section aria-labelledby="description-title">
          <h2 id="description-title">{t('listing.description')}</h2>
          <p className={styles.text}>{l.description}</p>
        </section>
        <Details l={l} t={t} lang={lang} />
        {l.saleFormat === 'auction' && <div ref={setExtraHost} />}
        {l.clarifications.length > 0 && (
          <section aria-labelledby="clarifications-title">
            <h2 id="clarifications-title">{t('listing.clarifications')}</h2>
            <ul className={styles.clarifications}>
              {l.clarifications.map((c) => (
                <li key={c.id}>
                  <p className={styles.text}>{c.body}</p>
                  <p className={styles.muted}>{t('listing.clarification_at', { at: formatDateTime(Date.parse(c.at), lang) })}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}

/** One gold star with the average and the number of ratings beside it (a drawn mark, not text). */
function Stars({ average, count, t, lang }: { average: number; count: number; t: T; lang: Lang }) {
  const shown = toLocalDigits(Math.min(5, Math.max(0, average)).toFixed(1), lang);
  return (
    <span className={styles.stars} role="img" aria-label={t('listing.rating', { average: shown, count: toLocalDigits(String(count), lang) })}>
      <svg viewBox="0 0 12 12" width="16" height="16" aria-hidden="true" focusable="false" className={styles.starFill}>
        <path fill="currentColor" d="M6 .9 L7.7 4.4 L11.5 4.9 L8.7 7.5 L9.4 11.3 L6 9.5 L2.6 11.3 L3.3 7.5 L.5 4.9 L4.3 4.4 Z" />
      </svg>
      <span aria-hidden="true">
        {shown} ({toLocalDigits(String(count), lang)})
      </span>
    </span>
  );
}

const Shield = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className={styles.shield}>
    <path
      d="M12 3 L20 6 V12 C20 16.5 16.5 19.8 12 21 C7.5 19.8 4 16.5 4 12 V6 Z M8.5 12.2 l2.4 2.4 l4.6 -5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function Status({ l, own, t }: { l: ListingView; own: boolean; t: T }) {
  if (l.status === 'sold')
    return (
      <p role="status" className={styles.notice}>
        {t('listing.status.sold')}
      </p>
    );
  if (l.status === 'ended_unsold')
    return (
      <p role="status" className={styles.notice}>
        {t('listing.status.ended_unsold')}
      </p>
    );
  if (l.status !== 'active' && own)
    return (
      <p role="status" className={styles.notice}>
        {t('listing.status.not_public', { status: t(`listing.status.${l.status}`) })}
      </p>
    );
  if (own) return <p className={styles.notice}>{t('listing.own')}</p>;
  return null;
}

/** A fixed-price item's buy panel (AC-LST-1), ruled like the home page: the price first and large, how many are left, the
 *  buy button, and one quiet line saying when the seller is paid (no steps and no state: a visitor has not paid yet; the
 *  steps appear at checkout and on the order, where they are real). On wide screens the panel stays in view while the page scrolls. */
function Buy({ l, own, t, lang }: { l: ListingView; own: boolean; t: T; lang: Lang }) {
  if (!l.price) return null;
  const price = formatMoney(l.price, lang);
  return (
    <section className={styles.buy} aria-labelledby="price-title">
      <h2 id="price-title" className={styles.buyLabel}>
        {t('listing.price')}
      </h2>
      <p className={styles.buyPrice}>{price}</p>
      {l.quantity.total > 1 && <p className={styles.buyNote}>{t('listing.available', { count: toLocalDigits(String(l.quantity.available), lang) })}</p>}
      {l.currentlyReserved && <p className={styles.notice}>{t('listing.currently_reserved')}</p>}
      {l.status === 'active' && !own && l.quantity.available > 0 && (
        <div className={styles.buyRow}>
          <Link className={styles.buyButton} to={`/checkout/${encodeURIComponent(l.id)}`}>
            {t('listing.buy')}
          </Link>
          <SaveButton id={l.id} t={t} />
        </div>
      )}
      <p className={styles.promise}>
        <Shield />
        {t('listing.promise.text')}
      </p>
    </section>
  );
}

/** "Save for later": for now a mark on this page only. Browser storage is not allowed outside the language module (SEC-SES-03), so keeping
 *  the mark between visits waits for the server list (task U10-29; Decisions log). */
function SaveButton({ t }: { id: string; t: T }) {
  const [saved, setSaved] = useState(false);
  const toggle = () => setSaved((v) => !v);
  return (
    <button type="button" className={saved ? `${styles.saveButton} ${styles.saved}` : styles.saveButton} aria-pressed={saved} onClick={toggle}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M6 4 H18 V21 L12 16.5 L6 21 Z" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      {saved ? t('listing.saved') : t('listing.save')}
    </button>
  );
}
