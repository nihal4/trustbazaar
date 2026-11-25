// The listing page (docs/design/08_frontend.pdf sections 3.3 and 7.3; IF-UI-03; U8-04; money-order world,
// docs/design/10_visual_v2.md, AC-LST: photos first and large; beside them the counterfoil, which holds the price,
// how the money moves and the buy button, or the auction panel with the payment promise; then the seller; on phones
// one column). It renders from one request,
// GET /listings/{id}, which includes the auction state (section 9). Everything the seller wrote is shown as text
// (SEC-INP-03); the location is the district only (FR-LST-06). A fixed-price item links to its checkout (U8-05);
// an auction shows its panel. Others see only public listings; the seller sees their own in every state.
import { useEffect, useState } from 'react';
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
import { isApiError } from '../../shared/problems';
import { EscrowSteps } from '../../shared/EscrowSteps';
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
      <div className={styles.gallery}>
        <Photos l={l} t={t} lang={lang} />
      </div>
      <aside className={styles.side}>
        {l.saleFormat === 'auction' && l.auction
          ? (<>
              <AuctionPanel initial={l.auction} t={t} lang={lang} signedIn={signedIn} own={own} nextPath={pathname} />
              <p className={styles.promise}><Shield />{t('listing.promise.title')}. {t('listing.promise.text')}</p>
            </>)
          : <Buy l={l} own={own} t={t} lang={lang} />}
        <section aria-labelledby="seller-title" className={styles.seller}>
          <h2 id="seller-title" className={styles.visuallyHidden}>{t('listing.seller')}</h2>
          <div className={styles.sellerRow}>
            <span className={styles.avatar} aria-hidden="true">{initials(l.seller.displayName)}</span>
            <div>
              <Link className={styles.sellerName} to={`/users/${encodeURIComponent(l.seller.id)}`}>{l.seller.displayName}</Link>
              <p className={styles.muted}>{t('listing.seller_joined', { month: joinMonth(l.seller.joinMonth, lang) })}</p>
            </div>
            {l.seller.verified && <p className={styles.verified}><Tick />{t('listing.seller_verified')}</p>}
          </div>
          {!own && ['active', 'sold', 'ended_unsold'].includes(l.status) && <MessageSeller listingId={l.id} signedIn={signedIn} nextPath={pathname} t={t} lang={lang} />}
        </section>
      </aside>
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

const Shield = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" className={styles.shield}>
    <path d="M12 3 L20 6 V12 C20 16.5 16.5 19.8 12 21 C7.5 19.8 4 16.5 4 12 V6 Z M8.5 12.2 l2.4 2.4 l4.6 -5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Tick = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="8" fill="currentColor" />
    <path d="M4.5 8.2 l2.3 2.3 l4.7 -5" fill="none" stroke="var(--tb-bg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The first letters of up to two words of the seller's name, for the round badge beside it. */
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => [...w][0] ?? '').join('').toUpperCase();


type T = ReturnType<typeof useT>['t'];

/** '2026-10' as "October 2026" in the page's language and digits. */
function joinMonth(ym: string, lang: Lang): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1));
}

function Status({ l, own, t }: { l: ListingView; own: boolean; t: T }) {
  if (l.status === 'sold') return <p role="status" className={styles.notice}>{t('listing.status.sold')}</p>;
  if (l.status === 'ended_unsold') return <p role="status" className={styles.notice}>{t('listing.status.ended_unsold')}</p>;
  if (l.status !== 'active' && own) return <p role="status" className={styles.notice}>{t('listing.status.not_public', { status: t(`listing.status.${l.status}`) })}</p>;
  if (own) return <p className={styles.notice}>{t('listing.own')}</p>;
  return null;
}

/** Photos at 1600 px with the 400 px thumbnail as a smaller alternative; the first one loads first (section 9): the
 *  others are asked for only once it has arrived (or after three seconds), so nothing shares the network with the
 *  page's largest paint (NFR-PERF-07; Decisions log, U10-10). */
function Photos({ l, t, lang }: { l: ListingView; t: T; lang: Lang }) {
  const [rest, setRest] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setRest(true), 3000);
    return () => window.clearTimeout(timer);
  }, []);
  if (l.photos.length === 0) return null;
  const total = toLocalDigits(String(l.photos.length), lang);
  return (
    <section aria-labelledby="photos-title">
      <h2 id="photos-title" className={styles.visuallyHidden}>{t('listing.photos')}</h2>
      {/* phones: one photo across, swiped sideways; wide screens: the first large, the rest in two columns under it */}
      <ul className={styles.photos} tabIndex={0}>
        {l.photos.map((p, i) => (
          <li key={p.id}>
            <img {...(i === 0 || rest ? { src: p.url, srcSet: `${p.thumbUrl} 400w, ${p.url} 1600w` } : {})} sizes="(min-width: 60rem) 40rem, 100vw"
              width={p.width} height={p.height} alt={t('listing.photo_alt', { title: l.title, n: toLocalDigits(String(i + 1), lang), total })}
              loading={i === 0 ? 'eager' : 'lazy'}
              {...(i === 0 ? { fetchpriority: 'high', onLoad: () => setRest(true), onError: () => setRest(true) } : {})} />
            {p.showsDefects && <span className={styles.badge}>{t('listing.shows_defects')}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A fixed-price item's buy panel (AC-LST-1), ruled like the home page: the price first and large, how many are left, the
 *  payment promise with the three steps of the money in order (an explanation, so no state is claimed), then the buy
 *  button. On wide screens the panel stays in view while the page scrolls. */
function Buy({ l, own, t, lang }: { l: ListingView; own: boolean; t: T; lang: Lang }) {
  if (!l.price) return null;
  const price = formatMoney(l.price, lang);
  return (
    <section className={styles.buy} aria-labelledby="price-title">
      <h2 id="price-title" className={styles.buyLabel}>{t('listing.price')}</h2>
      <p className={styles.buyPrice}>{price}</p>
      {l.quantity.total > 1 && <p className={styles.buyNote}>{t('listing.available', { count: toLocalDigits(String(l.quantity.available), lang) })}</p>}
      <div className={styles.buyPromise}>
        <p><Shield />{t('listing.promise.title')}</p>
        <EscrowSteps current="held" labels={[t('listing.counterfoil.in'), t('listing.counterfoil.held'), t('listing.counterfoil.out')]}
          classes={{ list: styles.steps, done: styles.stepDone, current: styles.stepNow }} />
      </div>
      {l.currentlyReserved && <p className={styles.notice}>{t('listing.currently_reserved')}</p>}
      {l.status === 'active' && !own && l.quantity.available > 0 && (
        <Link className={styles.buyButton} to={`/checkout/${encodeURIComponent(l.id)}`}>{t('listing.buy', { price })}</Link>
      )}
    </section>
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
  if (!signedIn) return <Link className={styles.ghost} to={`/signin?next=${encodeURIComponent(nextPath)}`}>{t('listing.message_seller_sign_in')}</Link>;
  return (
    <>
      {error !== null && <FormMessage kind="error">{errorText(error, t, lang)}</FormMessage>}
      <button type="button" className={styles.ghost} onClick={() => open(listingId)} disabled={busy} aria-busy={busy}>
        {t('listing.message_seller')}
      </button>
    </>
  );
}
