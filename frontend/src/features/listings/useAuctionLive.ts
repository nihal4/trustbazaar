// The live state of one auction, shared by the auction panel (the bid bar on the listing page) and the auction room: the state from the
// listing, from /state (on every live (re)connection, every 60 s, and every 5 s for guests, who have no live channel: DV-19, DV-55), from the
// live auction.state messages and from the answer to a bid. AuctionFeed keeps only the newest by seq, so a message arriving late never shows
// an older state. The countdown runs on the server's clock. The bidder's own maximum and lead come from my-status. Only one screen uses it at a
// time (a second one would join the live room and poll twice).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AuctionFeed } from '../../lib/live.js';
import { formatMoney } from '../../lib/money.js';
import { formatCountdown } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { serverClock, useServerNow, withServerTime } from '../../shared/clock';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { useLive, useLiveEvent } from '../../shared/live';
import { useAnnouncer } from './announcer';
import { historyKey, listingKey, myStatusKey, type AuctionState, type BidHistory, type MyStatus } from './model';

/** DV-19: guests poll the state; DV-55: signed-in pages fetch it again every 60 s besides the live feed. */
export const GUEST_POLL_MS = 5_000;
export const SIGNED_IN_POLL_MS = 60_000;
/** After the end, until the close is announced (DV-17 is 2 s; the closer runs every 2 s). */
export const CLOSING_POLL_MS = 3_000;

const money = (p: string | bigint, lang: Lang) => formatMoney(p, lang);

export function useAuctionLive({ initial, t, lang, signedIn, own }: { initial: AuctionState; t: T; lang: Lang; signedIn: boolean; own: boolean }) {
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
  useLiveEvent(
    'auction.state',
    (p) => {
      if (p.auctionId !== id) return;
      const at = Date.parse(String(p.serverTime));
      if (Number.isFinite(at)) serverClock.sampleMessage(at, Date.now());
      accept(p as unknown as AuctionState);
    },
    signedIn,
  );
  useLiveEvent(
    'auction.closed',
    (p) => {
      if (p.auctionId !== id) return;
      void refetch();
      refreshMine();
      void queryClient.invalidateQueries({ queryKey: listingKey(id) });
    },
    signedIn,
  );
  useLiveEvent(
    'auction.outbid',
    (p) => {
      if (p.auctionId !== id) return;
      say(t('auction.you_are_outbid'), true);
      refreshMine();
    },
    signedIn,
  );

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
  return { id, state, accept, refetch, myStatus, history, refreshMine, announcement, say, open, closing, now, left, countdown, mine };
}
