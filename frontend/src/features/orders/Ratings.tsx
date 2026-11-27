// Ratings on the order view (docs/design/08_frontend.pdf section 7.7; Unit 7 section 7; FR-REV-01 to FR-REV-06;
// U8-09). After the order's escrow is terminal each party may rate the other once, 1 to 5 stars with an optional
// text, until the rating window ends (CP-39); a rating can be edited until its edit period ends, and the rated party
// may reply once, publicly. GET /orders/{id}/ratings gives the window and both ratings (Decisions log, U8-09).
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { formatDateTime, formatDeadline } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { FRESHNESS } from '../../shared/query';
import type { OrderView } from './model';
import styles from './orders.module.css';

export interface RatingView {
  id: string; orderId: string; stars: number; text: string | null; createdAt: string; editableUntil: string; editedAt: string | null;
  reply: { text: string; at: string } | null;
}
export interface OrderRatings { canRate: boolean; rateUntil: string | null; mine: RatingView | null; received: RatingView | null }
export const ratingsKey = (orderId: string) => ['orders', orderId, 'ratings'] as const;

export function useOrderRatings(o: OrderView) {
  const api = useApi();
  const terminal = o.escrow !== null && ['released', 'refunded', 'partially_refunded'].includes(o.escrow.state);
  return useQuery({
    queryKey: ratingsKey(o.id),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(o.id)}/ratings`, { signal }) as Promise<OrderRatings>,
    staleTime: FRESHNESS.money,
    retry: false,
    enabled: terminal,
  });
}

/** One star, drawn once; filled when it is part of the rating. */
const Star = ({ on }: { on: boolean }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
    <path d="M12 2.8 L14.9 8.9 L21.5 9.7 L16.6 14.2 L17.9 20.8 L12 17.5 L6.1 20.8 L7.4 14.2 L2.5 9.7 L9.1 8.9 Z"
      fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
  </svg>
);

const starsText = (n: number, t: T, lang: Lang) => t('rating.stars', { n: toLocalDigits(String(n), lang) });

export function Ratings({ o, r, t, lang }: { o: OrderView; r: OrderRatings; t: T; lang: Lang }) {
  const now = useServerNow();
  const other = o.role === 'buyer' ? 'seller' : 'buyer';
  if (!r.canRate && !r.mine && !r.received) return null;
  return (
    <section aria-labelledby="ratings-title" className={styles.panel}>
      <h2 id="ratings-title">{t('rating.title')}</h2>
      {r.canRate && r.rateUntil && (
        <>
          <p className={styles.hint}>{t('rating.window', { until: formatDeadline(Date.parse(r.rateUntil), now, lang) })}</p>
          <RatingForm o={o} t={t} lang={lang} label={t(`rating.rate_${other}`)} />
        </>
      )}
      {r.mine && <Mine o={o} rating={r.mine} t={t} lang={lang} />}
      {r.received && <Received o={o} rating={r.received} from={other} t={t} lang={lang} />}
    </section>
  );
}

/** The stars as five ruled cells on one line: the real radio buttons stay (hidden by clipping, so the keyboard and the screen reader work as before),
 *  each label is a cell with its star and number; the cells up to the chosen one are filled. */
function StarsField({ id, value, onChange, t, lang }: { id: string; value: number; onChange: (n: number) => void; t: T; lang: Lang }) {
  return (
    <fieldset className={styles.starsField}>
      <legend>{t('rating.stars_label')}</legend>
      <div className={styles.starGrid}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={styles.starCell}>
            <input id={`${id}-${n}`} type="radio" name={id} checked={value === n} onChange={() => onChange(n)} />
            <label htmlFor={`${id}-${n}`} data-n={toLocalDigits(String(n), lang)} className={n <= value ? styles.starOn : undefined}>
              <Star on={n <= value} />
              <span className={styles.srOnly}>{starsText(n, t, lang)}</span>
            </label>
          </span>
        ))}
      </div>
    </fieldset>
  );
}

function RatingForm({ o, t, lang, label, initial, onDone }: {
  o: OrderView; t: T; lang: Lang; label: string; initial?: RatingView; onDone?: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [stars, setStars] = useState(initial?.stars ?? 0);
  const [text, setText] = useState(initial?.text ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => initial
      ? api.patch(`/ratings/${encodeURIComponent(initial.id)}`, { stars, text: text.trim() || null })
      : api.post(`/orders/${encodeURIComponent(o.id)}/rating`, { stars, ...(text.trim() ? { text: text.trim() } : {}) }),
    onSuccess: () => {
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: ratingsKey(o.id) });
      onDone?.();
    },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (stars < 1) return setMessage(t('rating.stars_needed'));
    save.mutate();
  };
  const id = initial ? `rating-edit-${initial.id}` : 'rating-new';
  return (
    <form onSubmit={submit} noValidate className={styles.form} aria-label={label}>
      <h3>{label}</h3>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <StarsField id={`${id}-stars`} value={stars} onChange={setStars} t={t} lang={lang} />
      <label htmlFor={`${id}-text`}>{t('rating.text')}</label>
      <textarea id={`${id}-text`} className={styles.ratingText} value={text} rows={3} maxLength={1000} onChange={(e) => setText(e.target.value)} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className={styles.hint}>{t('rating.public_note')}</p>
      <div className={styles.buttons}>
        <button type="submit" className={styles.primary} disabled={save.isPending}>{t(initial ? 'rating.save_edit' : 'rating.send')}</button>
        {onDone && <button type="button" className={styles.secondary} onClick={onDone}>{t('actions.back')}</button>}
      </div>
    </form>
  );
}

function Shown({ rating, t, lang }: { rating: RatingView; t: T; lang: Lang }) {
  return (
    <>
      <p className={styles.shownStars}>
        <span className={styles.starRow} aria-hidden="true">{[1, 2, 3, 4, 5].map((n) => <Star key={n} on={n <= rating.stars} />)}</span>
        <strong>{starsText(rating.stars, t, lang)}</strong>{rating.editedAt ? ` · ${t('rating.edited')}` : ''}
      </p>
      {rating.text && <p className={styles.wrap}>{rating.text}</p>}
      {rating.reply && <p className={styles.reply}>{t('rating.reply_shown', { text: rating.reply.text })}</p>}
    </>
  );
}

function Mine({ o, rating, t, lang }: { o: OrderView; rating: RatingView; t: T; lang: Lang }) {
  const now = useServerNow();
  const [editing, setEditing] = useState(false);
  const editable = Date.parse(rating.editableUntil) > now;
  if (editing) return <RatingForm o={o} t={t} lang={lang} label={t('rating.edit_title')} initial={rating} onDone={() => setEditing(false)} />;
  return (
    <div className={styles.request}>
      <h3>{t('rating.yours')}</h3>
      <Shown rating={rating} t={t} lang={lang} />
      {editable && (
        <>
          <p className={styles.hint}>{t('rating.edit_until', { until: formatDateTime(Date.parse(rating.editableUntil), lang) })}</p>
          <button type="button" className={styles.secondary} onClick={() => setEditing(true)}>{t('rating.edit')}</button>
        </>
      )}
    </div>
  );
}

function Received({ o, rating, from, t, lang }: { o: OrderView; rating: RatingView; from: 'buyer' | 'seller'; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const reply = useMutation({
    mutationFn: () => api.post(`/ratings/${encodeURIComponent(rating.id)}/reply`, { text: text.trim() }),
    onSuccess: () => { setText(''); void queryClient.invalidateQueries({ queryKey: ratingsKey(o.id) }); },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  return (
    <div className={styles.request}>
      <h3>{t(`rating.from_${from}`)}</h3>
      <Shown rating={rating} t={t} lang={lang} />
      {!rating.reply && (
        <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (text.trim()) reply.mutate(); else setMessage(t('rating.reply_empty')); }}>
          <label htmlFor={`reply-${rating.id}`}>{t('rating.reply')}</label>
          <p className={styles.hint}>{t('rating.reply_note')}</p>
          {message && <FormMessage kind="error">{message}</FormMessage>}
          <textarea id={`reply-${rating.id}`} className={styles.ratingText} value={text} rows={3} maxLength={1000} onChange={(e) => setText(e.target.value)} />
          <div className={styles.buttons}>
            <button type="submit" className={styles.primary} disabled={reply.isPending}>{t('rating.send_reply')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
