// The listing page (docs/design/08_frontend.pdf sections 3.3 and 7.3; IF-UI-03; U8-04; money-order world,
// docs/design/10_visual_v2.md, AC-LST: photos first and large; beside them the counterfoil, which holds the price,
// how the money moves and the buy button, or the auction panel with the payment promise; then the seller; on phones
// one column). It renders from one request,
// GET /listings/{id}, which includes the auction state (section 9). Everything the seller wrote is shown as text
// (SEC-INP-03); the location is the district only (FR-LST-06). A fixed-price item links to its checkout (U8-05);
// an auction shows its panel. Others see only public listings; the seller sees their own in every state.
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { takeEarly } from '../../shared/early';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { useMe } from '../../shared/me';
import { useOpenThread } from '../../shared/chat';
import { ChatIcon } from '../../shared/icons';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { AuctionPanel } from './AuctionPanel';
import { listingKey, type ListingView } from './model';
import en from '../../messages/en/listings.json';
import bn from '../../messages/bn/listings.json';
import styles from './listings.module.css';

const CATALOGUES = { en, bn };

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const me = useMe();
  const { pathname } = useLocation();
  const listing = useQuery({
    queryKey: listingKey(id),
    queryFn: async ({ signal }) => (await takeEarly<ListingView>(`/listings/${id}`)) ?? (api.get(`/listings/${encodeURIComponent(id)}`, { signal }) as Promise<ListingView>),
    staleTime: FRESHNESS.search,
    retry: false,
  });

  // On wide screens the right column stays in view down to the footer, so the footer makes room beside it (shell.module.css reads
  // html[data-rail] and --tb-rail-reserve) instead of covering it or pushing it up.
  const rail = useRef<HTMLDivElement>(null);
  const ready = listing.isSuccess;
  useEffect(() => {
    const el = rail.current;
    if (!ready || !el || typeof ResizeObserver === 'undefined') return undefined;
    const root = document.documentElement;
    const apply = () => {
      if (window.innerWidth >= 960) {
        root.dataset.rail = 'on';
        root.style.setProperty('--tb-rail-reserve', `${Math.round(el.getBoundingClientRect().width + 48)}px`);
      } else {
        delete root.dataset.rail;
        root.style.removeProperty('--tb-rail-reserve');
      }
    };
    apply();
    const watch = new ResizeObserver(apply);
    watch.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', apply);
      delete root.dataset.rail;
      root.style.removeProperty('--tb-rail-reserve');
    };
  }, [ready]);

  if (listing.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (listing.isError) {
    return isApiError(listing.error, 404)
      ? <div><h1>{t('listing.not_found')}</h1><p><Link to="/search">{t('shell.home_link')}</Link></p></div>
      : <FormMessage kind="error">{errorText(listing.error, t, lang)}</FormMessage>;
  }
  const l = listing.data;
  const own = me.data?.id === l.seller.id;
  const signedIn = me.isSuccess;
  const category = lang === 'bn' ? l.category.nameBn : l.category.nameEn;
  return (
    <article className={l.photos.length > 0 ? styles.page : `${styles.page} ${styles.noPhotos}`}>
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
        <h1 className={styles.title}>{l.title}</h1>
        <Status l={l} own={own} t={t} />
        {l.itemKind === 'game_account' && (
          <section aria-labelledby="game-risk-title" className={styles.risk}>
            <h2 id="game-risk-title">{t('listing.game_risk_title')}</h2>
            {[1, 2, 3].map((n) => <p key={n}>{t(`listing.game_risk.${n}`)}</p>)}
          </section>
        )}
      </header>
      <aside className={styles.side}>
        {l.saleFormat === 'auction' && l.auction
          ? (<>
              <AuctionPanel initial={l.auction} t={t} lang={lang} signedIn={signedIn} own={own} nextPath={pathname} />
              <p className={styles.promise}><Shield />{t('listing.promise.text')}</p>
            </>)
          : <Buy l={l} own={own} t={t} lang={lang} />}
        <section aria-labelledby="seller-title" className={styles.seller}>
          <h2 id="seller-title" className={styles.visuallyHidden}>{t('listing.seller')}</h2>
          <div className={l.seller.pro === true || l.seller.ratingCount ? `${styles.sellerRow} ${styles.sellerRowRated}` : styles.sellerRow}>
            <span className={styles.avatar} aria-hidden="true">{initials(l.seller.displayName)}</span>
            <div className={styles.sellerInfo}>
              <p className={styles.sellerLine}>
                <Link className={styles.sellerName} to={`/users/${encodeURIComponent(l.seller.id)}`}>{l.seller.displayName}</Link>
                {l.seller.verified && <span className={styles.tick} title={t('listing.seller_verified')}><Tick /><span className={styles.visuallyHidden}>{t('listing.seller_verified')}</span></span>}
              </p>
              <p className={styles.sellerMeta}>{t('listing.seller_since', { year: toLocalDigits(l.seller.joinMonth.slice(0, 4), lang) })}</p>
            </div>
            {(l.seller.pro === true || l.seller.ratingCount) ? (
              <div className={styles.sellerRating}>
                {l.seller.ratingCount ? <Stars average={l.seller.ratingAverage ?? 0} count={l.seller.ratingCount} t={t} lang={lang} /> : null}
                {l.seller.pro === true && <span className={styles.pro}>{t('listing.seller_pro')}</span>}
              </div>
            ) : null}
            {!own && ['active', 'sold', 'ended_unsold'].includes(l.status) && <MessageSeller listingId={l.id} signedIn={signedIn} nextPath={pathname} t={t} lang={lang} />}
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
      <span aria-hidden="true">{shown} ({toLocalDigits(String(count), lang)})</span>
    </span>
  );
}

const Shield = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className={styles.shield}>
    <path d="M12 3 L20 6 V12 C20 16.5 16.5 19.8 12 21 C7.5 19.8 4 16.5 4 12 V6 Z M8.5 12.2 l2.4 2.4 l4.6 -5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The verified mark: a scalloped seal with a tick, drawn once and sized by its parent. */
const Tick = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path d="M22.96 12.00 L22.84 12.71 L22.49 13.38 L22.00 13.99 L21.48 14.54 L21.03 15.07 L20.72 15.61 L20.55 16.22 L20.50 16.91 L20.48 17.67 L20.40 18.44 L20.17 19.16 L19.75 19.75 L19.16 20.17 L18.44 20.40 L17.67 20.48 L16.91 20.50 L16.22 20.55 L15.61 20.72 L15.07 21.03 L14.54 21.48 L13.99 22.00 L13.38 22.49 L12.71 22.84 L12.00 22.96 L11.29 22.84 L10.62 22.49 L10.01 22.00 L9.46 21.48 L8.93 21.03 L8.39 20.72 L7.78 20.55 L7.09 20.50 L6.33 20.48 L5.56 20.40 L4.84 20.17 L4.25 19.75 L3.83 19.16 L3.60 18.44 L3.52 17.67 L3.50 16.91 L3.45 16.22 L3.28 15.61 L2.97 15.07 L2.52 14.54 L2.00 13.99 L1.51 13.38 L1.16 12.71 L1.04 12.00 L1.16 11.29 L1.51 10.62 L2.00 10.01 L2.52 9.46 L2.97 8.93 L3.28 8.39 L3.45 7.78 L3.50 7.09 L3.52 6.33 L3.60 5.56 L3.83 4.84 L4.25 4.25 L4.84 3.83 L5.56 3.60 L6.33 3.52 L7.09 3.50 L7.78 3.45 L8.39 3.28 L8.93 2.97 L9.46 2.52 L10.01 2.00 L10.62 1.51 L11.29 1.16 L12.00 1.04 L12.71 1.16 L13.38 1.51 L13.99 2.00 L14.54 2.52 L15.07 2.97 L15.61 3.28 L16.22 3.45 L16.91 3.50 L17.67 3.52 L18.44 3.60 L19.16 3.83 L19.75 4.25 L20.17 4.84 L20.40 5.56 L20.48 6.33 L20.50 7.09 L20.55 7.78 L20.72 8.39 L21.03 8.93 L21.48 9.46 L22.00 10.01 L22.49 10.62 L22.84 11.29 Z" fill="currentColor" strokeLinejoin="round" />
    <path d="M7.6 12.4 l3.2 3.2 l5.8 -6.4" fill="none" stroke="var(--tb-bg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The first letters of up to two words of the seller's name, for the round badge beside it. */
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] ?? '').join('').toUpperCase();


type T = ReturnType<typeof useT>['t'];

function Status({ l, own, t }: { l: ListingView; own: boolean; t: T }) {
  if (l.status === 'sold') return <p role="status" className={styles.notice}>{t('listing.status.sold')}</p>;
  if (l.status === 'ended_unsold') return <p role="status" className={styles.notice}>{t('listing.status.ended_unsold')}</p>;
  if (l.status !== 'active' && own) return <p role="status" className={styles.notice}>{t('listing.status.not_public', { status: t(`listing.status.${l.status}`) })}</p>;
  if (own) return <p className={styles.notice}>{t('listing.own')}</p>;
  return null;
}

/** One large photo with a row of small ones under it; pressing a small one shows it in the large place (every kind of item).
 *  Physical items also get a magnifying glass: with a mouse, hovering the large photo shows it enlarged under the pointer
 *  (a game account has no object to inspect, so none). The large photo is the 1600 px file with the 400 px thumbnail as a
 *  smaller alternative; the small ones are asked for only once it has arrived (or after three seconds), so nothing shares
 *  the network with the page's largest paint (NFR-PERF-07; Decisions log, U10-10). */
function Photos({ l, t, lang }: { l: ListingView; t: T; lang: Lang }) {
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
      <h2 id="photos-title" className={styles.visuallyHidden}>{t('listing.photos')}</h2>
      <div className={magnify ? `${styles.stage} ${styles.canZoom}` : styles.stage} style={{ aspectRatio: `${p.width} / ${p.height}` }}
        onPointerMove={move} onPointerLeave={() => setGlass(null)}>
        <img key={p.id} src={p.url} srcSet={`${p.thumbUrl} 400w, ${p.url} 1600w`} sizes="(min-width: 60rem) 40rem, 100vw"
          width={p.width} height={p.height} alt={t('listing.photo_alt', { title: l.title, n: toLocalDigits(String(at + 1), lang), total })}
          loading="eager" {...{ fetchpriority: 'high' }} onLoad={() => setRest(true)} onError={() => setRest(true)} />
        {p.showsDefects && <span className={styles.badge}>{t('listing.shows_defects')}</span>}
        {magnify && glass && (
          <span className={styles.glass} aria-hidden="true" style={{ backgroundImage: `url("${p.url}")`, backgroundPosition: `${glass.x}% ${glass.y}%` }} />
        )}
      </div>
      {l.photos.length > 1 && (
        <ul className={styles.thumbs}>
          {l.photos.map((q, i) => (
            <li key={q.id}>
              <button type="button" className={i === at ? `${styles.thumb} ${styles.thumbOn}` : styles.thumb} aria-pressed={i === at}
                aria-label={t('listing.show_photo', { n: toLocalDigits(String(i + 1), lang), total })} onClick={() => setAt(i)}>
                <img {...(rest || i === at ? { src: q.thumbUrl } : {})} alt="" width={q.width} height={q.height} loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A fixed-price item's buy panel (AC-LST-1), ruled like the home page: the price first and large, how many are left, the
 *  buy button, and one quiet line saying when the seller is paid (no steps and no state: a visitor has not paid yet; the
 *  steps appear at checkout and on the order, where they are real). On wide screens the panel stays in view while the page scrolls. */
function Buy({ l, own, t, lang }: { l: ListingView; own: boolean; t: T; lang: Lang }) {
  if (!l.price) return null;
  const price = formatMoney(l.price, lang);
  return (
    <section className={styles.buy} aria-labelledby="price-title">
      <h2 id="price-title" className={styles.buyLabel}>{t('listing.price')}</h2>
      <p className={styles.buyPrice}>{price}</p>
      {l.quantity.total > 1 && <p className={styles.buyNote}>{t('listing.available', { count: toLocalDigits(String(l.quantity.available), lang) })}</p>}
      {l.currentlyReserved && <p className={styles.notice}>{t('listing.currently_reserved')}</p>}
      {l.status === 'active' && !own && l.quantity.available > 0 && (
        <div className={styles.buyRow}>
          <Link className={styles.buyButton} to={`/checkout/${encodeURIComponent(l.id)}`}>{t('listing.buy')}</Link>
          <SaveButton id={l.id} t={t} />
        </div>
      )}
      <p className={styles.promise}><Shield />{t('listing.promise.text')}</p>
    </section>
  );
}

/** "Save for later": a mark on this device (the list is kept in the browser until the server keeps saved items; Decisions log). */
const SAVED_KEY = 'tb.saved';
function readSaved(): string[] {
  try { const v = JSON.parse(window.localStorage.getItem(SAVED_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
function SaveButton({ id, t }: { id: string; t: T }) {
  const [saved, setSaved] = useState(() => readSaved().includes(id));
  const toggle = () => {
    const next = !saved;
    try {
      const rest = readSaved().filter((x) => x !== id);
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next ? [id, ...rest].slice(0, 200) : rest));
    } catch { /* storage may be blocked: the mark then lasts until the page closes */ }
    setSaved(next);
  };
  return (
    <button type="button" className={saved ? `${styles.saveButton} ${styles.saved}` : styles.saveButton} aria-pressed={saved} onClick={toggle}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 4 H18 V21 L12 16.5 L6 21 Z" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
      {saved ? t('listing.saved') : t('listing.save')}
    </button>
  );
}

function Details({ l, t, lang }: { l: ListingView; t: T; lang: Lang }) {
  return (
    <section aria-labelledby="details-title">
      <h2 id="details-title">{t('listing.details')}</h2>
      <dl className={styles.details}>
        <dt>{t('listing.category')}</dt>
        <dd>{lang === 'bn' ? l.category.nameBn : l.category.nameEn}</dd>
        {l.condition && (<><dt>{t('listing.condition')}</dt><dd>{t(`listing.condition.${l.condition}`)}</dd></>)}
        {l.noVisibleDefects !== null && <dd className={styles.wide}>{l.noVisibleDefects ? t('listing.no_visible_defects') : t('listing.defects_in_photos')}</dd>}
        {l.fulfilmentOptions && (<><dt>{t('listing.fulfilment')}</dt><dd>{t(`listing.fulfilment.${l.fulfilmentOptions}`)}</dd></>)}
        {l.district && (<><dt>{t('listing.district')}</dt><dd>{l.district}</dd></>)}
      </dl>
    </section>
  );
}

/** FR-CHT-01: a conversation with the seller about this listing (U8-13); signed-out visitors sign in first. */
function MessageSeller({ listingId, signedIn, nextPath, t, lang }: { listingId: string; signedIn: boolean; nextPath: string; t: T; lang: Lang }) {
  const { open, busy, error } = useOpenThread();
  // one ruled cell at the end of the seller row: a chat mark (its name is in the label, for the screen reader and the tooltip)
  if (!signedIn) return <Link className={styles.chatCell} to={`/signin?next=${encodeURIComponent(nextPath)}`} aria-label={t('listing.message_seller_sign_in')} title={t('listing.message_seller_sign_in')}><ChatIcon /></Link>;
  return (
    <>
      <button type="button" className={styles.chatCell} onClick={() => open(listingId)} disabled={busy} aria-busy={busy} aria-label={t('listing.message_seller')} title={t('listing.message_seller')}>
        <ChatIcon />
      </button>
      {error !== null && <div className={styles.chatError}><FormMessage kind="error">{errorText(error, t, lang)}</FormMessage></div>}
    </>
  );
}
