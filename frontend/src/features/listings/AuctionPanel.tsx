// The auction panel of the listing page (docs/design/08_frontend.pdf section 7.3; IF-UI-03; FR-AUC-01 to FR-AUC-15;
// NFR-USE-01; U8-04). The state comes from the listing, from /state (on every live (re)connection, every 60 s, and
// every 5 s for guests, who have no live channel: DV-19, DV-55), from the live auction.state messages and from the
// answer to a bid; AuctionFeed keeps only the newest by seq, so a message arriving late never shows an older state.
// The countdown runs on the server's clock. The bidder's own maximum and lead come from my-status, shown only to
// them; after the close, the winner's order and a second-chance offer come from there too (Decisions log, U3-05).
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuctionFeed } from '../../lib/live.js';
import { formatMoney, parseTaka, toLocalDigits } from '../../lib/money.js';
import { formatCountdown, formatDateTime, formatDeadline } from '../../lib/time.js';
import { ApiError } from '../../lib/api.js';
import { useApi } from '../../shared/api';
import { serverClock, useServerNow, withServerTime } from '../../shared/clock';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { useLive, useLiveEvent } from '../../shared/live';
import { problemName } from '../../shared/problems';
import { useAnnouncer } from './announcer';
import { historyKey, listingKey, myStatusKey, type AuctionState, type BidHistory, type BidResult, type MyStatus } from './model';
import styles from './listings.module.css';

/** DV-19: guests poll the state; DV-55: signed-in pages fetch it again every 60 s besides the live feed. */
export const GUEST_POLL_MS = 5_000;
export const SIGNED_IN_POLL_MS = 60_000;
/** After the end, until the close is announced (DV-17 is 2 s; the closer runs every 2 s). */
export const CLOSING_POLL_MS = 3_000;

const money = (p: string | bigint, lang: Lang) => formatMoney(p, lang);

export function AuctionPanel({ initial, t, lang, signedIn, own, nextPath }: {
  initial: AuctionState; t: T; lang: Lang; signedIn: boolean; own: boolean; nextPath: string;
}) {
  const id = initial.auctionId;
  const api = useApi();
  const live = useLive();
  const queryClient = useQueryClient();
  const feed = useRef<AuctionFeed | null>(null);
  const [state, setState] = useState<AuctionState>(() => {
    const f = new AuctionFeed();
    f.apply(initial as never);
    feed.current = f;
    const at = Date.parse(initial.serverTime);
    if (Number.isFinite(at)) serverClock.sampleMessage(at, Date.now());
    return initial;
  });
  const { text: announcement, say } = useAnnouncer();

  /** Newer by seq; or the same seq closed, since closing does not change the auction's version. */
  const accept = useCallback((s: AuctionState) => {
    const f = feed.current!;
    const cur = f.state as unknown as AuctionState;
    const closedNow = cur && s.seq === cur.seq && cur.status === 'open' && s.status !== 'open';
    if (f.apply(s as never) || closedNow) {
      f.state = s as never;
      setState(s);
    }
  }, []);

  const refetch = useCallback(async () => {
    try {
      accept(await withServerTime(() => api.get(`/auctions/${encodeURIComponent(id)}/state`) as Promise<AuctionState>));
    } catch {
      // the next poll, message or reconnection tries again
    }
  }, [api, id, accept]);

  const myStatus = useQuery({
    queryKey: myStatusKey(id),
    queryFn: ({ signal }) => api.get(`/auctions/${encodeURIComponent(id)}/my-status`, { signal }) as Promise<MyStatus>,
    enabled: signedIn && !own,
    staleTime: 0,
    retry: false,
  });
  const history = useQuery({
    queryKey: historyKey(id),
    queryFn: ({ signal }) => api.get(`/auctions/${encodeURIComponent(id)}/bids`, { signal }) as Promise<BidHistory>,
    staleTime: 0,
    retry: false,
  });
  const refreshMine = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: myStatusKey(id) });
  }, [queryClient, id]);

  // the live room while the page is open; every (re)connection fetches the state, in case messages were missed
  const open = state.status === 'open';
  useEffect(() => {
    if (!live || !signedIn) return;
    const leave = live.join(`auction:${id}`);
    const off = live.onConnect(() => {
      void refetch();
      refreshMine();
    });
    return () => {
      off();
      leave();
    };
  }, [live, signedIn, id, refetch, refreshMine]);
  useLiveEvent('auction.state', (p) => {
    if (p.auctionId !== id) return;
    const at = Date.parse(String(p.serverTime));
    if (Number.isFinite(at)) serverClock.sampleMessage(at, Date.now());
    accept(p as unknown as AuctionState);
  }, signedIn);
  useLiveEvent('auction.closed', (p) => {
    if (p.auctionId !== id) return;
    void refetch();
    refreshMine();
    void queryClient.invalidateQueries({ queryKey: listingKey(id) });
  }, signedIn);
  useLiveEvent('auction.outbid', (p) => {
    if (p.auctionId !== id) return;
    say(t('auction.you_are_outbid'), true);
    refreshMine();
  }, signedIn);

  // polling: guests have no live channel; signed-in pages check every minute as well (DV-55)
  const now = useServerNow();
  const ended = Date.parse(state.endAt) <= now;
  const closing = open && ended;
  useEffect(() => {
    if (!open) return;
    const ms = closing ? CLOSING_POLL_MS : signedIn ? SIGNED_IN_POLL_MS : GUEST_POLL_MS;
    const timer = setInterval(() => void refetch(), ms);
    return () => clearInterval(timer);
  }, [open, closing, signedIn, refetch]);

  // the history and my-status follow the state; price changes are announced (at most every 5 s)
  const seen = useRef({ seq: state.seq, price: state.price, status: state.status });
  useEffect(() => {
    const before = seen.current;
    seen.current = { seq: state.seq, price: state.price, status: state.status };
    if (state.seq !== before.seq) void queryClient.invalidateQueries({ queryKey: historyKey(id) });
    if (state.price && state.price !== before.price) say(t('auction.announce.price', { price: money(state.price, lang) }));
    if (state.status !== before.status) refreshMine();
  }, [state, id, queryClient, say, t, lang, refreshMine]);

  // the countdown is announced at 5 minutes and at 1 minute, not every second
  const left = Date.parse(state.endAt) - now;
  const announced = useRef<{ five: boolean; one: boolean }>({ five: left <= 300_000, one: left <= 60_000 });
  useEffect(() => {
    if (!open) return;
    if (!announced.current.five && left <= 300_000 && left > 60_000) {
      announced.current.five = true;
      say(t('auction.announce.five_minutes'), true);
    }
    if (!announced.current.one && left <= 60_000 && left > 0) {
      announced.current = { five: true, one: true };
      say(t('auction.announce.one_minute'), true);
    }
  }, [left, open, say, t]);

  const countdown = formatCountdown(left, lang);
  const mine = myStatus.data;
  return (
    <section aria-labelledby="auction-title" className={styles.auction}>
      <h2 id="auction-title">{t('auction.title')}</h2>
      <p className={styles.visuallyHidden} aria-live="polite" role="status">{announcement}</p>
      <div className={styles.facts}>
        <p>
          {state.price ? t('auction.current_price') : t('auction.start_price')}:{' '}
          <strong className={styles.bigPrice}>{money(state.price ?? state.startPrice, lang)}</strong>
        </p>
        <p>{state.bidCount > 0 ? t('auction.bid_count', { count: toLocalDigits(String(state.bidCount), lang) }) : t('auction.no_bids')}</p>
        {state.leaderAlias !== null && <p>{t('auction.leader', { alias: toLocalDigits(String(state.leaderAlias), lang) })}</p>}
        {state.hasReserve && <p>{state.reserveMet ? t('auction.reserve_met') : t('auction.reserve_not_met')}</p>}
      </div>

      {open && (
        <div className={styles.clock}>
          <p>
            {t('auction.time_left')}: <strong role="timer" aria-live="off" className={countdown.urgent ? styles.urgent : undefined}>{countdown.text}</strong>
          </p>
          <p className={styles.muted}>{t('auction.ends_at', { at: formatDateTime(Date.parse(state.endAt), lang) })}</p>
          {countdown.urgent && <p className={styles.warning}>{t('auction.late_warning')}</p>}
          {closing && <p role="status">{t('auction.ending')}</p>}
        </div>
      )}
      {!open && <Closed state={state} t={t} lang={lang} mine={mine} />}

      {open && !closing && own && <p>{t('auction.own')}</p>}
      {open && !closing && !own && !signedIn && (
        <>
          <p><Link to={signInPath(nextPath)} className={styles.primaryLink}>{t('auction.sign_in_to_bid')}</Link></p>
          <p className={styles.muted}>{t('auction.guest_live')}</p>
        </>
      )}
      {open && !closing && !own && signedIn && (
        <BidForm id={id} state={state} mine={mine} t={t} lang={lang} onPlaced={(r, sentAt) => {
          const at = Date.parse(r.state.serverTime);
          if (Number.isFinite(at)) serverClock.sampleHttp(at, sentAt, Date.now());
          accept(r.state);
          refreshMine();
        }} onRefused={() => void refetch()} />
      )}
      {mine && open && mine.hasBid && (
        <p className={styles.mine}>
          {t('auction.your_maximum', { amount: money(mine.yourMaximum!, lang) })} {mine.leading ? t('auction.you_lead') : t('auction.you_are_outbid')}
        </p>
      )}

      <details className={styles.rules}>
        <summary>{t('auction.rules_title')}</summary>
        <ul>
          {(['increment', 'proxy', 'reserve', 'sniping', 'binding'] as const).map((k) => <li key={k}>{t(`auction.rules.${k}`)}</li>)}
        </ul>
      </details>

      <section aria-labelledby="history-title">
        <h3 id="history-title">{t('auction.history')}</h3>
        {history.data && history.data.items.length === 0 && <p>{t('auction.history_empty')}</p>}
        {history.data && history.data.items.length > 0 && (
          <ol className={styles.history}>
            {history.data.items.map((b) => (
              <li key={b.id}>
                <span>{t('auction.history_bidder', { alias: toLocalDigits(String(b.bidderAlias), lang) })}</span>
                <span>{money(b.amount, lang)}{b.leading ? ` (${t('auction.history_leading')})` : ''}</span>
                <span className={styles.muted}>{formatDateTime(Date.parse(b.at), lang)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

const amountError = (reason: string, t: T) => t(`auction.amount.${reason}`);

function BidForm({ id, state, mine, t, lang, onPlaced, onRefused }: {
  id: string; state: AuctionState; mine: MyStatus | undefined; t: T; lang: Lang;
  onPlaced: (r: BidResult, sentAt: number) => void; onRefused: () => void;
}) {
  const api = useApi();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<bigint | null>(null);
  const leading = mine?.leading === true;
  // sent once (section 4.2): a second click before the button shows as disabled sends nothing
  const sending = useRef(false);
  const send = (maximum: bigint) => {
    if (sending.current) return;
    sending.current = true;
    place.mutate(maximum, { onSettled: () => { sending.current = false; } });
  };

  const place = useMutation({
    mutationFn: async (maximum: bigint) => {
      const sentAt = Date.now();
      const r = await api.post(`/auctions/${encodeURIComponent(id)}/bids`, { maximum: String(maximum) }, { idempotent: true }) as BidResult;
      return { r, sentAt };
    },
    onSuccess: ({ r, sentAt }) => {
      setConfirming(null);
      setAmount('');
      onPlaced(r, sentAt);
      const price = money(r.state.price ?? r.state.startPrice, lang);
      setResult(r.outcome === 'leading' ? { kind: 'success', text: t('auction.result.leading', { price }) }
        : r.outcome === 'raised_own_max' ? { kind: 'success', text: t('auction.result.raised_own_max', { amount: money(r.yourMaximum, lang) }) }
        : { kind: 'info', text: t('auction.result.outbid', { price }) });
    },
    onError: (e) => {
      setConfirming(null);
      setResult({ kind: 'error', text: refusalText(e, t, lang) });
      onRefused();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setResult(null);
    const p = parseTaka(amount);
    if (!p.ok) return setError(amountError(p.reason, t));
    // explained before sending: below the minimum, or not above one's own maximum (the server decides in the end)
    if (leading && mine?.yourMaximum && p.poisha <= BigInt(mine.yourMaximum)) return setError(t('auction.refused.max_not_higher'));
    if (!leading && state.minimumBid && p.poisha < BigInt(state.minimumBid)) {
      return setError(t('auction.below_minimum', { amount: money(state.minimumBid, lang) }));
    }
    setError(null);
    setConfirming(p.poisha);
  };

  const label = leading ? t('auction.raise_label') : t('auction.amount_label');
  return (
    <form onSubmit={submit} noValidate className={styles.bid}>
      {state.minimumBid && !leading && <p><strong>{t('auction.minimum', { amount: money(state.minimumBid, lang) })}</strong></p>}
      {result && <FormMessage kind={result.kind}>{result.text}</FormMessage>}
      <label htmlFor="bid-amount">{label}</label>
      <input id="bid-amount" type="text" inputMode="decimal" autoComplete="off" value={amount} maxLength={20}
        aria-invalid={error ? true : undefined} aria-describedby={error ? 'bid-amount-error' : undefined}
        onChange={(e) => setAmount(e.target.value)} />
      {error && <p id="bid-amount-error" className={styles.fieldError}>{error}</p>}
      <button type="submit" className={styles.primary} disabled={place.isPending}>{leading ? t('auction.raise') : t('auction.place_bid')}</button>
      {confirming !== null && (
        <ConfirmDialog id="bid-confirm" title={t('auction.confirm_title')} busy={place.isPending}
          confirmLabel={t('auction.confirm_button', { amount: money(confirming, lang) })} cancelLabel={t('auction.cancel')}
          onConfirm={() => send(confirming)} onCancel={() => setConfirming(null)}>
          <p>{t('confirm.place_bid', { amount: money(confirming, lang) })}</p>
          {(!state.minimumBid || confirming > BigInt(state.minimumBid) || leading) && <p>{t('confirm.proxy_bid', { amount: money(confirming, lang) })}</p>}
          <p aria-live="polite">{t('auction.price_now', { amount: money(state.price ?? state.startPrice, lang) })}</p>
          {state.minimumBid && !leading && confirming < BigInt(state.minimumBid) && (
            <p className={styles.fieldError}>{t('auction.below_minimum', { amount: money(state.minimumBid, lang) })}</p>
          )}
        </ConfirmDialog>
      )}
    </form>
  );
}

/** A refused bid in words (Decisions log, U3-04: 422 bid-refused with a stable reason; 409 auction-busy). */
export function refusalText(e: unknown, t: T, lang: Lang): string {
  const name = problemName(e);
  if (name === 'auction-busy') return t('auction.busy');
  if (name === 'transaction-not-allowed') return t('auction.not_allowed');
  if (name === 'bid-refused' && e instanceof ApiError && Array.isArray(e.errors)) {
    const r = e.errors[0] as { reason?: string; minimum?: string; until?: string };
    if (r?.reason === 'below_minimum' && r.minimum) return t('auction.refused.below_minimum', { amount: money(r.minimum, lang) });
    if (r?.reason === 'bidder_restricted') return t('auction.refused.bidder_restricted', { until: r.until ? formatDateTime(Date.parse(r.until), lang) : '-' });
    if (r?.reason && ['max_not_higher', 'auction_ended', 'auction_not_open', 'seller_cannot_bid'].includes(r.reason)) return t(`auction.refused.${r.reason}`);
  }
  return errorText(e, t, lang);
}

function Closed({ state, t, lang, mine }: { state: AuctionState; t: T; lang: Lang; mine: MyStatus | undefined }) {
  return (
    <div className={styles.closed}>
      <p role="status">
        {state.status === 'awarded' ? t('auction.closed.awarded', { price: money(state.price ?? state.startPrice, lang) })
          : state.status === 'unsold' ? t('auction.closed.unsold') : t('auction.closed.cancelled')}
      </p>
      {mine?.orderId && (
        <p>
          {t('auction.won')}{' '}
          <Link to={`/orders/${encodeURIComponent(mine.orderId)}`} className={styles.primaryLink}>{t('auction.go_to_order')}</Link>
        </p>
      )}
      {mine?.secondChanceOffer && <Offer auctionId={state.auctionId} offer={mine.secondChanceOffer} t={t} lang={lang} />}
    </div>
  );
}

/** FR-AUC-15: the offered bidder accepts (an order to pay within CP-11) or declines. */
function Offer({ auctionId, offer, t, lang }: { auctionId: string; offer: NonNullable<MyStatus['secondChanceOffer']>; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const now = useServerNow();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const decide = useMutation({
    mutationFn: (decision: 'accept' | 'decline') =>
      api.post(`/auctions/${encodeURIComponent(auctionId)}/second-chance/${encodeURIComponent(offer.id)}/decision`, { decision }) as
        Promise<{ status: 'accepted' | 'declined'; orderId: string | null }>,
    onSuccess: (r) => {
      setConfirming(false);
      if (r.status === 'accepted' && r.orderId) void navigate(`/orders/${encodeURIComponent(r.orderId)}`);
      else setMessage({ kind: 'info', text: t('auction.offer.declined') });
      void queryClient.invalidateQueries({ queryKey: myStatusKey(auctionId) });
    },
    onError: (e) => {
      setConfirming(false);
      setMessage({ kind: 'error', text: problemName(e) === 'offer-closed' ? t('auction.offer.closed') : errorText(e, t, lang) });
      void queryClient.invalidateQueries({ queryKey: myStatusKey(auctionId) });
    },
  });
  const sending = useRef(false);
  const send = (decision: 'accept' | 'decline') => {
    if (sending.current) return;
    sending.current = true;
    decide.mutate(decision, { onSettled: () => { sending.current = false; } });
  };
  const price = money(offer.price, lang);
  return (
    <div className={styles.offer} role="region" aria-labelledby="offer-title">
      <h3 id="offer-title">{t('auction.offer.title')}</h3>
      <p>{t('auction.offer.body', { price })}</p>
      <p>{t('auction.offer.deadline', { at: formatDeadline(Date.parse(offer.expiresAt), now, lang) })}</p>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={decide.isPending} onClick={() => setConfirming(true)}>{t('auction.offer.accept', { price })}</button>
        <button type="button" disabled={decide.isPending} onClick={() => send('decline')}>{t('auction.offer.decline')}</button>
      </div>
      {confirming && (
        <ConfirmDialog id="offer-confirm" title={t('auction.offer.confirm_title')} busy={decide.isPending}
          confirmLabel={t('auction.offer.accept', { price })} cancelLabel={t('auction.cancel')}
          onConfirm={() => send('accept')} onCancel={() => setConfirming(false)}>
          <p>{t('auction.offer.confirm', { price })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
