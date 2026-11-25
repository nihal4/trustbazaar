// The auction room (U10-30; docs/design/10_visual_v3.md section 10): a live view of one open auction for signed-in users. Bidders sit in an arc, one
// seat per bidder alias, the leader's seat in vermilion and the viewer's own ringed; under it the price, the controls and, beside it, the live bids.
// It reads the same state as the listing's bid bar (useAuctionLive) and bids through the same BidForm, so every bid is checked, confirmed and sent
// once as everywhere else; the quick-bid buttons only fill the field. The arc is decoration (aria-hidden): the list, the price and the controls carry
// the meaning. The seller sees the room read-only. "Sit this one out" turns off this page's announcements and nothing else (no storage, SEC-SES-03).
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { takeEarly } from '../../shared/early';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { serverClock } from '../../shared/clock';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { useMe } from '../../shared/me';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { BidForm } from './AuctionPanel';
import { listingKey, type ListingView } from './model';
import { useAuctionLive } from './useAuctionLive';
import en from '../../messages/en/listings.json';
import bn from '../../messages/bn/listings.json';
import styles from './listings.module.css';

const CATALOGUES = { en, bn };
type T = ReturnType<typeof useT>['t'];
const money = (p: string | bigint, lang: Lang) => formatMoney(p, lang);
const MAX_SEATS = 9;

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
  if (listing.isPending || me.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (me.isError) return <Navigate to={signInPath(pathname)} replace />;
  if (listing.isError) {
    return isApiError(listing.error, 404)
      ? <div><h1>{t('listing.not_found')}</h1><p><Link to="/search">{t('shell.home_link')}</Link></p></div>
      : <FormMessage kind="error">{errorText(listing.error, t, lang)}</FormMessage>;
  }
  const l = listing.data;
  if (l.saleFormat !== 'auction' || !l.auction) {
    return <div><h1>{l.title}</h1><p>{t('room.not_auction')}</p><p><Link to={`/listings/${encodeURIComponent(id)}`}>{t('room.back')}</Link></p></div>;
  }
  return <Room l={l} auction={l.auction} own={me.data.id === l.seller.id} t={t} lang={lang} />;
}

/** The seats' places on the arc: a few bidders sit close together near the middle, many spread out to the ends. */
function seatAt(i: number, n: number) {
  const step = Math.min(0.14, 1 / Math.max(1, n - 1));
  const a = Math.PI * (1 - (0.5 + (i - (n - 1) / 2) * step));
  return { x: 400 + 330 * Math.cos(a), y: 225 - 165 * Math.sin(a) };
}

function Room({ l, auction, own, t, lang }: { l: ListingView; auction: NonNullable<ListingView['auction']>; own: boolean; t: T; lang: Lang }) {
  const live = useAuctionLive({ initial: auction, t, lang, signedIn: true, own });
  const { state, history, mine, open, closing, countdown, accept, refreshMine, refetch, announcement } = live;
  const [sitOut, setSitOut] = useState(false);
  const items = history.data?.items ?? [];
  // seats: the bidders who have bid, in the order they first bid (the server does not report who is only watching)
  const aliases = [...new Set([...items].reverse().map((b) => b.bidderAlias))];
  const seats = aliases.slice(0, MAX_SEATS);
  // a row that arrives after the room opened flashes once (not with reduced motion; see the stylesheet)
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!history.data) return;
    const ids = new Set(history.data.items.map((b) => b.id));
    if (seen.current) setFresh(new Set([...ids].filter((x) => !seen.current!.has(x))));
    seen.current = ids;
  }, [history.data]);
  const price = money(state.price ?? state.startPrice, lang);
  const biddingOpen = open && !closing && !own;
  const base = BigInt(state.minimumBid ?? state.price ?? state.startPrice);
  const photo = l.photos[0];
  return (
    <div className={styles.room}>
      <header className={styles.roomHead}>
        {photo && <img className={styles.roomThumb} src={photo.thumbUrl} alt="" width={64} height={64} />}
        <div className={styles.roomTitle}>
          <p className={styles.roomLive}>{open ? <><span className={styles.liveDot} aria-hidden="true" />{t('room.live')}</> : t('room.closed')}</p>
          <h1>{l.title}</h1>
        </div>
        {open && (
          <div className={styles.roomStat}>
            <span className={styles.barK}>{t('room.time_left')}</span>
            <strong role="timer" aria-live="off" className={countdown.urgent ? `${styles.barV} ${styles.urgent}` : styles.barV}>{countdown.text}</strong>
          </div>
        )}
        <div className={styles.roomStat}>
          <span className={styles.barK}>{t('room.in_room')}</span>
          <strong className={styles.barV}>{toLocalDigits(String(aliases.length), lang)}</strong>
        </div>
      </header>

      <div className={styles.roomStage}>
        <svg viewBox="0 0 800 270" aria-hidden="true" focusable="false">
          <path d="M70 225 A330 165 0 0 1 730 225" fill="none" stroke="var(--tb-line)" strokeWidth="1" />
          {seats.map((alias, i) => {
            const { x, y } = seatAt(i, seats.length);
            const cls = [styles.seat, alias === state.leaderAlias ? styles.seatLead : '', alias === mine?.yourAlias ? styles.seatMe : ''].filter(Boolean).join(' ');
            return (
              <g key={alias} className={cls}>
                <circle cx={x} cy={y} r="34" />
                <text x={x} y={y + 5}>{alias === mine?.yourAlias ? t('room.you') : `B${toLocalDigits(String(alias), lang)}`}</text>
              </g>
            );
          })}
        </svg>
        <div className={styles.podium}>
          <span className={styles.muted}>{t('room.price')}</span>
          <strong className={styles.roomPrice}>{price}</strong>
          {state.leaderAlias !== null && <span className={styles.muted}>{t('room.leading', { alias: t('room.seat', { alias: toLocalDigits(String(state.leaderAlias), lang) }) })}</span>}
        </div>
      </div>

      <section className={styles.roomControls} aria-label={t('room.quick')}>
        {biddingOpen ? (
          <>
            <BidForm id={state.auctionId} state={state} mine={mine} t={t} lang={lang} quick={[base, base + 50_000n, base + 100_000n]}
              onPlaced={(r, sentAt) => {
                const at = Date.parse(r.state.serverTime);
                if (Number.isFinite(at)) serverClock.sampleHttp(at, sentAt, Date.now());
                accept(r.state);
                refreshMine();
              }} onRefused={() => void refetch()} />
            <p className={styles.muted}>{t('room.quick_hint')}</p>
            <button type="button" className={styles.sitOut} aria-pressed={sitOut} onClick={() => setSitOut((v) => !v)}>{sitOut ? t('room.join_in') : t('room.sit_out')}</button>
            {sitOut && <p className={styles.muted} role="note">{t('room.sit_out_note')}</p>}
          </>
        ) : (
          <p role="status">{own ? t('room.own') : !open ? t('room.closed') : t('auction.ending')}</p>
        )}
        <p><Link to={`/listings/${encodeURIComponent(l.id)}`}>{t('room.back')}</Link></p>
      </section>

      <aside className={styles.roomFeed} aria-labelledby="room-feed-title">
        <h2 id="room-feed-title">{t('room.feed')}</h2>
        {items.length === 0 ? <p className={styles.muted}>{t('room.feed_empty')}</p> : (
          <ol className={styles.history}>
            {items.map((b) => (
              <li key={b.id} className={fresh.has(b.id) ? styles.flash : undefined}>
                <span>{t('auction.history_bidder', { alias: toLocalDigits(String(b.bidderAlias), lang) })}</span>
                <span>{money(b.amount, lang)}{b.leading ? ` (${t('auction.history_leading')})` : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </aside>
      {!sitOut && <p className={styles.visuallyHidden} aria-live="polite" role="status">{announcement}</p>}
    </div>
  );
}
