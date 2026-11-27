// Publishing a listing: what is still missing (the start price and the reserve of an auction), the limit on live listings, and the answer: published, or sent
// for review.
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { parseTaka } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { fieldErrors, problemName } from '../../shared/problems';
import { useOwnership } from './GameListing';
import { durationLabel, reasonTexts, type EditableListing, type SellingTerms } from './sell';
import styles from './sell.module.css';
import { Button, Input, Select } from '../../shared/ui';
import { listingKey, percentOf } from './sellShared';

export function Publish({ l, terms, t, lang }: { l: EditableListing; terms: SellingTerms; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const auction = l.saleFormat === 'auction';
  const [start, setStart] = useState('');
  const [reserve, setReserve] = useState('');
  const [duration, setDuration] = useState(terms.auctionDurations[0] ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const ownership = useOwnership(l);
  const game = l.itemKind === 'game_account';
  const blocked = game && !ownership.data?.details;
  const publish = useMutation({
    mutationFn: (body: Record<string, string>) => api.post(`/listings/${encodeURIComponent(l.id)}/publish`, body) as Promise<EditableListing>,
    onSuccess: (r) => {
      setErrors([]);
      setDone(r.status === 'pending_review' ? t('sell.sent_to_review') : t('sell.published'));
      void queryClient.invalidateQueries({ queryKey: listingKey(l.id) });
      void queryClient.invalidateQueries({ queryKey: ['me', 'selling-terms'] });
    },
    onError: (e) => {
      const name = problemName(e);
      if (name === 'listing-not-publishable' || name === 'validation-failed') return setErrors(reasonTexts(fieldErrors(e), t));
      setErrors([name === 'listing-limit' ? t('sell.limit_reached') : errorText(e, t, lang)]);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!auction) return publish.mutate({});
    const problems: string[] = [];
    const s = parseTaka(start);
    const r = reserve.trim() ? parseTaka(reserve) : null;
    if (!s.ok || s.poisha <= 0n) problems.push(t('sell.need.start_price'));
    if (r && !r.ok) problems.push(t('sell.need.reserve'));
    if (s.ok && r?.ok && r.poisha < s.poisha) problems.push(t('sell.reserve_below'));
    setErrors(problems);
    if (problems.length || !s.ok) return;
    publish.mutate({ startPrice: String(s.poisha), ...(r?.ok ? { reservePrice: String(r.poisha) } : {}), duration });
  };
  return (
    <form onSubmit={submit} noValidate className={`${styles.panel} ${styles.form}`} aria-labelledby="publish-title">
      <h2 id="publish-title">{t('sell.publish_title')}</h2>
      {errors.length > 0 && (
        <div role="alert" className={styles.errors}>
          <ul>
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {done && <FormMessage kind="success">{done}</FormMessage>}
      {auction && (
        <>
          <label htmlFor="start-price">{t('sell.start_price')}</label>
          <Input block id="start-price" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
          <label htmlFor="reserve-price">{t('sell.reserve_price')}</label>
          <Input block id="reserve-price" inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value)} aria-describedby="reserve-hint" />
          <p id="reserve-hint" className={styles.hint}>
            {t('sell.reserve_hint')}
          </p>
          <label htmlFor="duration">{t('sell.duration')}</label>
          <Select block id="duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
            {terms.auctionDurations.map((d) => (
              <option key={d} value={d}>
                {durationLabel(d, t, lang)}
              </option>
            ))}
          </Select>
        </>
      )}
      {game && <p>{t(blocked ? 'sell.game.details_first' : 'sell.game.review_first')}</p>}
      <p>{t('sell.commission_payout', { percent: percentOf(terms.commissionBps, lang) })}</p>
      <p>{t(auction ? 'sell.fixed_after_publish_auction' : 'sell.fixed_after_publish')}</p>
      <div className={styles.buttons}>
        <Button variant="primary" type="submit" disabled={publish.isPending || blocked}>
          {t('sell.publish')}
        </Button>
      </div>
    </form>
  );
}
