import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { parseTaka } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { type AuctionState, type BidResult, type MyStatus } from './model';
import styles from './listings.module.css';
import { Button } from '../../shared/ui';
import { money, amountError, refusalText } from './auctionShared';

/** The bid form, with its checks, its confirmation and its single send. The auction room passes `quick`: amounts (in poisha) that fill the field and
 *  go through the same checks and the same confirmation dialog; nothing is sent by pressing one. */
export function BidForm({
  id,
  state,
  mine,
  t,
  lang,
  onPlaced,
  onRefused,
  quick = [],
  quickHint,
}: {
  id: string;
  state: AuctionState;
  mine: MyStatus | undefined;
  t: T;
  lang: Lang;
  onPlaced: (r: BidResult, sentAt: number) => void;
  onRefused: () => void;
  quick?: bigint[];
  quickHint?: string;
}) {
  const api = useApi();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<bigint | null>(null);
  const leading = mine?.leading === true;
  // "You are leading at ..." was true when the bid was placed: once another bid overtakes it, it is removed, so the panel
  // never says both that and "You have been outbid" (U8-11)
  useEffect(() => {
    if (!leading) setResult((r) => (r?.kind === 'success' ? null : r));
  }, [leading]);
  // sent once (section 4.2): a second click before the button shows as disabled sends nothing
  const sending = useRef(false);
  const send = (maximum: bigint) => {
    if (sending.current) return;
    sending.current = true;
    place.mutate(maximum, {
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const place = useMutation({
    mutationFn: async (maximum: bigint) => {
      const sentAt = Date.now();
      const r = (await api.post(`/auctions/${encodeURIComponent(id)}/bids`, { maximum: String(maximum) }, { idempotent: true })) as BidResult;
      return { r, sentAt };
    },
    onSuccess: ({ r, sentAt }) => {
      setConfirming(null);
      setAmount('');
      onPlaced(r, sentAt);
      const price = money(r.state.price ?? r.state.startPrice, lang);
      setResult(
        r.outcome === 'leading'
          ? { kind: 'success', text: t('auction.result.leading', { price }) }
          : r.outcome === 'raised_own_max'
            ? { kind: 'success', text: t('auction.result.raised_own_max', { amount: money(r.yourMaximum, lang) }) }
            : { kind: 'info', text: t('auction.result.outbid', { price }) },
      );
    },
    onError: (e) => {
      setConfirming(null);
      setResult({ kind: 'error', text: refusalText(e, t, lang) });
      onRefused();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    check(amount);
  };
  const check = (text: string) => {
    setResult(null);
    const p = parseTaka(text);
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
      {quick.length > 0 && (
        <div className={styles.quickBids} role="group" aria-label={t('room.quick')}>
          {quick.map((q) => {
            const text = (q / 100n).toString();
            return (
              <button
                type="button"
                key={text}
                className={styles.quickBid}
                onClick={() => {
                  setAmount(text);
                  check(text);
                }}
              >
                {money(q, lang)}
              </button>
            );
          })}
        </div>
      )}
      {quick.length > 0 && quickHint && <p className={styles.quickHint}>{quickHint}</p>}
      {state.minimumBid && !leading && (
        <p>
          <strong>{t('auction.minimum', { amount: money(state.minimumBid, lang) })}</strong>
        </p>
      )}
      {result && <FormMessage kind={result.kind}>{result.text}</FormMessage>}
      <label htmlFor="bid-amount" className={styles.visuallyHidden}>
        {label}
      </label>
      <input
        id="bid-amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={amount}
        maxLength={20}
        placeholder={t('auction.amount_placeholder')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'bid-amount-error' : undefined}
        onChange={(e) => setAmount(e.target.value)}
      />
      {error && (
        <p id="bid-amount-error" role="alert" className={styles.fieldError}>
          {error}
        </p>
      )}
      <Button variant="primary" type="submit" disabled={place.isPending}>
        {leading ? t('auction.raise') : t('auction.place_bid')}
      </Button>
      {confirming !== null && (
        <ConfirmDialog
          id="bid-confirm"
          title={t('auction.confirm_title')}
          busy={place.isPending}
          confirmLabel={t('auction.confirm_button', { amount: money(confirming, lang) })}
          cancelLabel={t('auction.cancel')}
          onConfirm={() => send(confirming)}
          onCancel={() => setConfirming(null)}
        >
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
