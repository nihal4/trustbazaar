// The listing page (docs/design/08_frontend.pdf sections 3.3 and 7.3; IF-UI-03; U8-04). It renders from one request,
// GET /listings/{id}, which includes the auction state (section 9). Everything the seller wrote is shown as text
// (SEC-INP-03); the location is the district only (FR-LST-06). A fixed-price item links to its checkout (U8-05);
// an auction shows its panel. Others see only public listings; the seller sees their own in every state.
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { useMe } from '../../shared/me';
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
    queryFn: ({ signal }) => api.get(`/listings/${encodeURIComponent(id)}`, { signal }) as Promise<ListingView>,
    staleTime: FRESHNESS.search,
    retry: false,
  });

  if (listing.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (listing.isError) {
    return isApiError(listing.error, 404)
      ? <div className={styles.page}><h1>{t('listing.not_found')}</h1><p><Link to="/search">{t('shell.home_link')}</Link></p></div>
      : <FormMessage kind="error">{errorText(listing.error, t, lang)}</FormMessage>;
  }
  const l = listing.data;
  const own = me.data?.id === l.seller.id;
  const signedIn = me.isSuccess;
  return (
    <article className={styles.page}>
      <h1 className={styles.title}>{l.title}</h1>
      {l.itemKind === 'game_account' && <p className={styles.kind}>{t('listing.game_account')}</p>}
      <Status l={l} own={own} t={t} />
      <div className={styles.layout}>
        <div>
          <Photos l={l} t={t} lang={lang} />
          <section aria-labelledby="description-title">
            <h2 id="description-title">{t('listing.description')}</h2>
            <p className={styles.text}>{l.description}</p>
          </section>
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
        <aside className={styles.side}>
          {l.saleFormat === 'auction' && l.auction
            ? <AuctionPanel initial={l.auction} t={t} lang={lang} signedIn={signedIn} own={own} nextPath={pathname} />
            : <Buy l={l} own={own} t={t} lang={lang} />}
          <Details l={l} t={t} lang={lang} />
          <section aria-labelledby="seller-title" className={styles.seller}>
            <h2 id="seller-title">{t('listing.seller')}</h2>
            <p><Link to={`/users/${encodeURIComponent(l.seller.id)}`}>{l.seller.displayName}</Link></p>
            {l.seller.verified && <p>{t('listing.seller_verified')}</p>}
            <p className={styles.muted}>{t('listing.seller_joined', { month: joinMonth(l.seller.joinMonth, lang) })}</p>
          </section>
        </aside>
      </div>
    </article>
  );
}

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

/** Photos at 1600 px with the 400 px thumbnail as a smaller alternative; the first one loads first (section 9). */
function Photos({ l, t, lang }: { l: ListingView; t: T; lang: Lang }) {
  if (l.photos.length === 0) return null;
  const total = toLocalDigits(String(l.photos.length), lang);
  return (
    <section aria-labelledby="photos-title">
      <h2 id="photos-title" className={styles.visuallyHidden}>{t('listing.photos')}</h2>
      <ul className={styles.photos}>
        {l.photos.map((p, i) => (
          <li key={p.id}>
            <img src={p.url} srcSet={`${p.thumbUrl} 400w, ${p.url} 1600w`} sizes="(min-width: 60rem) 40rem, 100vw"
              width={p.width} height={p.height} alt={t('listing.photo_alt', { title: l.title, n: toLocalDigits(String(i + 1), lang), total })}
              loading={i === 0 ? 'eager' : 'lazy'} {...(i === 0 ? { fetchpriority: 'high' } : {})} />
            {p.showsDefects && <span className={styles.badge}>{t('listing.shows_defects')}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Buy({ l, own, t, lang }: { l: ListingView; own: boolean; t: T; lang: Lang }) {
  if (!l.price) return null;
  const price = formatMoney(l.price, lang);
  return (
    <section aria-labelledby="price-title" className={styles.buy}>
      <h2 id="price-title" className={styles.visuallyHidden}>{t('listing.price')}</h2>
      <p className={styles.bigPrice}>{price}</p>
      {l.quantity.total > 1 && <p>{t('listing.available', { count: toLocalDigits(String(l.quantity.available), lang) })}</p>}
      {l.currentlyReserved && <p className={styles.notice}>{t('listing.currently_reserved')}</p>}
      {l.status === 'active' && !own && l.quantity.available > 0 && (
        <Link to={`/checkout/${encodeURIComponent(l.id)}`} className={styles.primaryLink}>{t('listing.buy', { price })}</Link>
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
