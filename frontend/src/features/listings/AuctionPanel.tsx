// The auction panel of the listing page (docs/design/08_frontend.pdf section 7.3; IF-UI-03; FR-AUC-01 to FR-AUC-15;
// NFR-USE-01; U8-04). The state comes from the listing, from /state (on every live (re)connection, every 60 s, and
// every 5 s for guests, who have no live channel: DV-19, DV-55), from the live auction.state messages and from the
// answer to a bid; AuctionFeed keeps only the newest by seq, so a message arriving late never shows an older state.
// The countdown runs on the server's clock. The bidder's own maximum and lead come from my-status, shown only to
// them; after the close, the winner's order and a second-chance offer come from there too (Decisions log, U3-05).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

import { toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';

import { serverClock } from '../../shared/clock';

import { signInPath } from '../../shared/document';

import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';

import { Countdown } from './Countdown';
import { useAuctionLive } from './useAuctionLive';
import { type AuctionState, type MyStatus } from './model';
import styles from './listings.module.css';

import { BidForm } from './AuctionBidForm';
import { money } from './auctionShared';
import { Offer } from './AuctionOffer';

export { GUEST_POLL_MS, SIGNED_IN_POLL_MS, CLOSING_POLL_MS } from './useAuctionLive';

export function AuctionPanel({
  initial,
  t,
  lang,
  signedIn,
  own,
  nextPath,
  extraHost = null,
}: {
  initial: AuctionState;
  t: T;
  lang: Lang;
  signedIn: boolean;
  own: boolean;
  nextPath: string;
  /** where the rules and the bid history go: under the description, so the panel in the fixed column stays short (null: under the panel) */
  extraHost?: HTMLElement | null;
}) {
  const { id, state, accept, refetch, history, refreshMine, announcement, open, closing, countdown, left, mine } = useAuctionLive({
    initial,
    t,
    lang,
    signedIn,
    own,
  });
  const [sheet, setSheet] = useState(false);
  const [barOpen, setBarOpen] = useState(false); // phones only: the bar is a small floating tab until it is opened
  const closeRef = useRef<HTMLButtonElement>(null);
  const seeRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // the sheet is non-modal: focus moves to its close button when it opens and returns to "See the bids" when it closes; Escape closes it
  // (unless a confirmation dialog is open, which takes Escape itself)
  useEffect(() => {
    if (!sheet) return undefined;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        setSheet(false);
        seeRef.current?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [sheet]);

  const extraNode = (
    <div className={styles.extra}>
      <details className={styles.rules}>
        <summary>{t('auction.rules_title')}</summary>
        <ul>
          {(['increment', 'proxy', 'reserve', 'sniping', 'binding'] as const).map((k) => (
            <li key={k}>{t(`auction.rules.${k}`)}</li>
          ))}
        </ul>
      </details>

      <section
        id="history-box"
        aria-labelledby="history-title"
        tabIndex={sheet ? -1 : undefined}
        className={sheet ? `${styles.historyBox} ${styles.sheetOpen}` : styles.historyBox}
      >
        <div className={styles.sheetHead}>
          <h3 id="history-title">{t('auction.history')}</h3>
          {sheet && (
            <button
              type="button"
              ref={closeRef}
              className={styles.sheetClose}
              aria-label={t('shell.close')}
              onClick={() => {
                setSheet(false);
                seeRef.current?.focus();
              }}
            >
              <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true" focusable="false">
                <path d="M2 2l8 8M10 2l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        {history.data && history.data.items.length === 0 && <p>{t('auction.history_empty')}</p>}
        {history.data && history.data.items.length > 0 && (
          <ol className={styles.history}>
            {history.data.items.map((b) => (
              <li key={b.id}>
                <span>{t('auction.history_bidder', { alias: toLocalDigits(String(b.bidderAlias), lang) })}</span>
                <span>
                  {money(b.amount, lang)}
                  {b.leading ? ` (${t('auction.history_leading')})` : ''}
                </span>
                <span className={styles.muted}>{formatDateTime(Date.parse(b.at), lang)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
  // the bar at the bottom of the screen carries what a bidder needs at a glance: the price, the clock, a way to see the bids and the bid
  // itself; it shows while bidding is open and the viewer can bid (a guest gets the sign-in link)
  const barVisible = open && !closing && !own;
  useEffect(() => {
    if (!barVisible) setSheet(false);
  }, [barVisible]);
  // the bar's real height (and what sits under it, such as the phone tab bar) as --bar-h: the sheet, the room at the end of the page and the
  // scroll padding all use it instead of fixed numbers
  useEffect(() => {
    const el = barRef.current;
    const root = document.documentElement;
    if (!barVisible || !el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => root.style.setProperty('--bar-h', `${Math.round(window.innerHeight - el.getBoundingClientRect().top)}px`);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      watch.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--bar-h');
    };
  }, [barVisible]);
  const priceBlock = (
    <>
      <span className={styles.barK}>{state.price ? t('auction.current_price') : t('auction.start_price')}</span>
      <strong className={styles.barV}>{money(state.price ?? state.startPrice, lang)}</strong>
    </>
  );
  const bar = (
    <div className={styles.bidBar} role="group" aria-label={t('auction.place_bid')} ref={barRef} data-open={barOpen}>
      <button
        type="button"
        className={styles.barToggle}
        aria-expanded={barOpen}
        aria-controls="bid-bar-body"
        onClick={() => setBarOpen((v) => !v)}
        aria-label={barOpen ? t('shell.close') : `${t('auction.open_bar')}: ${money(state.price ?? state.startPrice, lang)}`}
      >
        <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true" focusable="false" className={barOpen ? styles.chevDown : styles.chevLeft}>
          <path d="M8 1.5 L3.5 6 L8 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {!barOpen && <span className={styles.toggleText} aria-hidden="true" data-price={money(state.price ?? state.startPrice, lang)} />}
      </button>
      <div className={styles.barBody} id="bid-bar-body" data-room={signedIn}>
        <div className={styles.barCell}>{priceBlock}</div>
        <div className={styles.barCell}>
          <span className={styles.barK}>{t('auction.time_left')}</span>
          <Countdown left={left} text={countdown.text} urgent={countdown.urgent} t={t} lang={lang} />
        </div>
        <div className={`${styles.barCell} ${styles.barMid}`}>
          <button
            type="button"
            ref={seeRef}
            className={styles.seeBids}
            aria-expanded={sheet}
            aria-controls="history-box"
            onClick={() => setSheet((v) => !v)}
            aria-label={state.bidCount > 0 ? `${t('auction.see_bids')} (${toLocalDigits(String(state.bidCount), lang)})` : undefined}
          >
            <span className={styles.seeLabel}>{t('auction.see_bids')}</span>
            {state.bidCount > 0 && (
              <span className={styles.bidCount} aria-hidden="true">
                {toLocalDigits(String(state.bidCount), lang)}
              </span>
            )}
            <span className={styles.seeArrow} aria-hidden="true">
              <svg viewBox="0 0 12 12" width="12" height="12" focusable="false" className={sheet ? styles.seeChevOpen : styles.seeChev}>
                <path d="M2 7.5 L6 3.5 L10 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>
        {signedIn && (
          <Link to={`/listings/${encodeURIComponent(id)}/room`} className={styles.barRoom}>
            <span className={styles.liveDot} aria-hidden="true" />
            {t('room.join')}
          </Link>
        )}
        <div className={styles.barAct}>
          {!signedIn ? (
            <Link to={signInPath(nextPath)} className={styles.primaryLink}>
              {t('auction.sign_in_to_bid')}
            </Link>
          ) : (
            <BidForm
              id={id}
              state={state}
              mine={mine}
              t={t}
              lang={lang}
              onPlaced={(r, sentAt) => {
                const at = Date.parse(r.state.serverTime);
                if (Number.isFinite(at)) serverClock.sampleHttp(at, sentAt, Date.now());
                accept(r.state);
                refreshMine();
              }}
              onRefused={() => void refetch()}
            />
          )}
        </div>
      </div>
    </div>
  );
  return (
    <>
      <section aria-labelledby="auction-title" className={styles.auction} data-closed={open ? undefined : 'true'}>
        <div className={styles.auctionTop}>
          <h2 id="auction-title">{t('auction.title')}</h2>
        </div>
        <p className={styles.visuallyHidden} aria-live="polite" role="status">
          {announcement}
        </p>
        <div className={styles.facts}>
          {!barVisible && (
            <p className={styles.priceLine}>
              <span className={styles.muted}>{state.price ? t('auction.current_price') : t('auction.start_price')}</span>{' '}
              <strong className={styles.bigPrice}>{money(state.price ?? state.startPrice, lang)}</strong>
            </p>
          )}
          <div className={styles.factGrid}>
            <p>{state.bidCount > 0 ? t('auction.bid_count', { count: toLocalDigits(String(state.bidCount), lang) }) : t('auction.no_bids')}</p>
            {state.leaderAlias !== null && <p>{t('auction.leader', { alias: toLocalDigits(String(state.leaderAlias), lang) })}</p>}
            {state.hasReserve && <p>{state.reserveMet ? t('auction.reserve_met') : t('auction.reserve_not_met')}</p>}
            {open && <p className={styles.muted}>{t('auction.ends_at', { at: formatDateTime(Date.parse(state.endAt), lang) })}</p>}
          </div>
        </div>

        {open && (countdown.urgent || closing) && (
          <div className={styles.clock}>
            {countdown.urgent && <p className={styles.warning}>{t('auction.late_warning')}</p>}
            {closing && <p role="status">{t('auction.ending')}</p>}
          </div>
        )}
        {!open && <Closed state={state} t={t} lang={lang} mine={mine} />}
        {open && !closing && own && <p>{t('auction.own')}</p>}
        {open && !closing && !own && !signedIn && <p className={styles.muted}>{t('auction.guest_live')}</p>}
        {mine && open && mine.hasBid && (
          <p className={mine.leading ? styles.mine : `${styles.mine} ${styles.outbid}`}>
            {t('auction.your_maximum', { amount: money(mine.yourMaximum!, lang) })} {mine.leading ? t('auction.you_lead') : t('auction.you_are_outbid')}
          </p>
        )}
      </section>
      {barVisible && createPortal(bar, document.body)}
      {extraHost ? createPortal(extraNode, extraHost) : extraNode}
    </>
  );
}

function Closed({ state, t, lang, mine }: { state: AuctionState; t: T; lang: Lang; mine: MyStatus | undefined }) {
  let closedText = t('auction.closed.cancelled');
  if (state.status === 'awarded') closedText = t('auction.closed.awarded', { price: money(state.price ?? state.startPrice, lang) });
  else if (state.status === 'unsold') closedText = t('auction.closed.unsold');
  return (
    <div className={styles.closed}>
      <p role="status">{closedText}</p>
      {mine?.orderId && (
        <p>
          {t('auction.won')}{' '}
          <Link to={`/orders/${encodeURIComponent(mine.orderId)}`} className={styles.primaryLink}>
            {t('auction.go_to_order')}
          </Link>
        </p>
      )}
      {mine?.secondChanceOffer && <Offer auctionId={state.auctionId} offer={mine.secondChanceOffer} t={t} lang={lang} />}
    </div>
  );
}
