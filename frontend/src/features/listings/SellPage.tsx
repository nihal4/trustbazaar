// The listing editor, /sell/new and /sell/:id (docs/design/08_frontend.pdf section 7.3; FR-LST-01 to FR-LST-12,
// FR-MON-01; IF-SW-08; U8-14). A draft is created once (Idempotency-Key), then edited; photos are uploaded one by
// one with their progress, up to CP-33; the area is chosen on Unit 4's list, or found from the device's position
// after a button press with the list as the fallback. Before publishing the screen shows the commission that will
// be deducted from the payout (CP-25, from GET /me/selling-terms) and FR-LST-07's limit; an auction's terms are
// given at publication and never change. A listing sent to review says so. After publication only the fields the
// server still allows are offered, and clarifications can always be added. A game account (U8-07; Unit 5 section 3)
// has no condition, delivery or area and sells one; its game details and the ownership proof are on GameListing.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, parseTaka, toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { useMe } from '../../shared/me';
import { fieldErrors, isApiError, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { GameListing, useOwnership } from './GameListing';
import { commissionOf, durationLabel, nearestArea, reasonTexts, type Area, type Category, type EditableListing, type SellingTerms } from './sell';
import en from '../../messages/en/sell.json';
import bn from '../../messages/bn/sell.json';
import styles from './sell.module.css';

const CATALOGUES = { en, bn };
const CONDITIONS = ['new', 'like_new', 'used', 'for_parts'] as const;
const FULFILMENT = ['pickup_only', 'courier_only', 'pickup_or_courier'] as const;
const WEIGHTS = ['up_to_1kg', 'up_to_2kg', 'up_to_5kg', 'up_to_10kg', 'over_10kg'] as const;
const SIZES = ['small', 'medium', 'large', 'oversize'] as const;

const listingKey = (id: string) => ['listings', id, 'own'] as const;

export function Component() {
  const { id } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  useEffect(() => {
    if (me.isError) void navigate(signInPath(id ? `/sell/${id}` : '/sell/new'), { replace: true });
  }, [me.isError, navigate, id]);
  const terms = useQuery({
    queryKey: ['me', 'selling-terms'],
    queryFn: ({ signal }) => api.get('/me/selling-terms', { signal }) as Promise<SellingTerms>,
    staleTime: FRESHNESS.account,
    retry: false,
    enabled: me.isSuccess,
  });
  const listing = useQuery({
    queryKey: listingKey(id ?? ''),
    queryFn: ({ signal }) => api.get(`/listings/${encodeURIComponent(id ?? '')}`, { signal }) as Promise<EditableListing>,
    staleTime: FRESHNESS.account,
    retry: false,
    enabled: me.isSuccess && id !== undefined,
  });

  if (me.isPending || me.isError) return <p role="status">{t('shell.loading')}</p>;
  if (terms.isError) {
    return (
      <div className={styles.page}>
        <h1>{t('sell.title_new')}</h1>
        <FormMessage kind="info">{isApiError(terms.error, 403) ? t('sell.verify') : errorText(terms.error, t, lang)}</FormMessage>
      </div>
    );
  }
  if (!terms.data || (id && listing.isPending)) return <p role="status">{t('shell.loading')}</p>;
  if (id && (listing.isError || !listing.data?.own)) {
    return <div className={styles.page}><h1>{t('sell.not_found')}</h1></div>;
  }
  const l = listing.data ?? null;
  return (
    <div className={styles.page}>
      <h1>{l ? t('sell.title_edit', { title: l.title }) : t('sell.title_new')}</h1>
      {l && <p><strong>{t(`sell.status.${l.status}`)}</strong>{l.status !== 'draft' && <> · <Link to={`/listings/${encodeURIComponent(l.id)}`}>{t('sell.view_listing')}</Link></>}</p>}
      <p className={styles.hint}>{t('sell.limits', { count: toLocalDigits(String(terms.data.activeListings.count), lang), limit: toLocalDigits(String(terms.data.activeListings.limit), lang) })}</p>
      {(!l || l.status === 'draft' || (l.status === 'active' && !l.locked && l.saleFormat === 'fixed_price')) && (
        <DetailsForm key={l?.own?.updatedAt ?? 'new'} l={l} terms={terms.data} t={t} lang={lang} />
      )}
      {l && l.itemKind === 'physical' && l.status === 'draft' && <Photos l={l} terms={terms.data} t={t} lang={lang} />}
      {l && l.itemKind === 'game_account' && (l.status === 'draft' || l.status === 'pending_review') && <GameListing l={l} t={t} lang={lang} />}
      {l && l.status === 'draft' && <Publish l={l} terms={terms.data} t={t} lang={lang} />}
      {l && l.status === 'pending_review' && <FormMessage kind="info">{t(l.itemKind === 'game_account' ? 'sell.game.in_review' : 'sell.in_review')}</FormMessage>}
      {l && l.status === 'active' && (l.locked || l.saleFormat === 'auction') && <p>{t('sell.locked_note')}</p>}
      {l && l.status === 'active' && <Clarifications l={l} t={t} lang={lang} />}
    </div>
  );
}

function useAreas() {
  const api = useApi();
  return useQuery({
    queryKey: ['delivery', 'areas'],
    queryFn: ({ signal }) => api.get('/delivery/areas', { signal }) as Promise<{ items: Area[] }>,
    staleTime: FRESHNESS.reference,
  });
}

function DetailsForm({ l, terms, t, lang }: { l: EditableListing | null; terms: SellingTerms; t: T; lang: Lang }) {
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: ({ signal }) => api.get('/categories', { signal }) as Promise<Category[]>,
    staleTime: FRESHNESS.reference,
  });
  const areas = useAreas();
  const draft = !l || l.status === 'draft';
  const [itemKind, setItemKind] = useState<'physical' | 'game_account'>(l?.itemKind ?? 'physical');
  const game = itemKind === 'game_account';
  const [saleFormat, setSaleFormat] = useState<'fixed_price' | 'auction'>(l?.saleFormat ?? 'fixed_price');
  const [categoryId, setCategoryId] = useState(l ? String(l.category.id) : '');
  const [title, setTitle] = useState(l?.title ?? '');
  const [description, setDescription] = useState(l?.description ?? '');
  const [condition, setCondition] = useState<string>(l?.condition ?? '');
  const [noDefects, setNoDefects] = useState(l?.noVisibleDefects ?? false);
  const [fulfilment, setFulfilment] = useState<string>(l?.fulfilmentOptions ?? 'pickup_only');
  const [weight, setWeight] = useState<string>(l?.weightClass ?? '');
  const [size, setSize] = useState<string>(l?.sizeClass ?? '');
  const [price, setPrice] = useState(l?.price ? (BigInt(l.price) / 100n).toString() : '');
  const [quantity, setQuantity] = useState(l ? String(l.quantity.total) : '1');
  const [areaId, setAreaId] = useState('');
  const [located, setLocated] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const sending = useRef(false);

  const area = useMemo(() => (areas.data?.items ?? []).find((a) => String(a.id) === areaId) ?? null, [areas.data, areaId]);
  const courier = !game && fulfilment !== 'pickup_only';

  const locate = () => {
    if (!('geolocation' in navigator)) return setMessage(t('sell.location_unavailable'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        const near = nearestArea(areas.data?.items ?? [], p.coords.latitude, p.coords.longitude);
        if (!near) return setMessage(t('sell.location_unavailable'));
        setAreaId(String(near.id));
        setLocated({ lat: Math.round(p.coords.latitude * 1000) / 1000, lng: Math.round(p.coords.longitude * 1000) / 1000 });
      },
      () => { setLocating(false); setMessage(t('sell.location_unavailable')); },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (l
      ? api.patch(`/listings/${encodeURIComponent(l.id)}`, body)
      : api.post('/listings', body, { idempotent: true })) as Promise<EditableListing>,
    onSuccess: (saved) => {
      setMessage(null);
      setErrors([]);
      queryClient.setQueryData(listingKey(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: listingKey(saved.id) });
      if (!l) void navigate(`/sell/${encodeURIComponent(saved.id)}`, { replace: true });
    },
    onError: (e) => {
      const fields = fieldErrors(e);
      setErrors(reasonTexts(fields, t));
      setMessage(problemName(e) === 'listing-state' ? t('sell.changed') : fields.length ? null : errorText(e, t, lang));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problems: string[] = [];
    if (draft && !categoryId) problems.push(t('sell.need.category'));
    if (title.trim().length < 5) problems.push(t('sell.need.title'));
    if (description.trim().length < 20) problems.push(t('sell.need.description'));
    if (!game && !condition) problems.push(t('sell.need.condition'));
    if (courier && (!weight || !size)) problems.push(t('sell.need.parcel'));
    let poisha: bigint | null = null;
    if (saleFormat === 'fixed_price') {
      const p = parseTaka(price);
      if (!p.ok || p.poisha <= 0n) problems.push(t('sell.need.price'));
      else poisha = p.poisha;
    }
    const q = Number(quantity);
    if (saleFormat === 'fixed_price' && !game && !(Number.isInteger(q) && q >= 1 && q <= 9999)) problems.push(t('sell.need.quantity'));
    if (!l && !game && !area) problems.push(t('sell.need.area'));
    setErrors(problems);
    if (problems.length || sending.current) return;
    const body: Record<string, unknown> = {
      ...(draft ? { categoryId: Number(categoryId) } : {}),
      title: title.trim(), description: description.trim(),
      ...(game ? {} : {
        condition, noVisibleDefects: noDefects,
        fulfilmentOptions: fulfilment, weightClass: courier ? weight : null, sizeClass: courier ? size : null,
      }),
      ...(saleFormat === 'fixed_price' ? { price: String(poisha), quantity: game ? 1 : q } : {}),
      ...(area && !game ? { area: { district: area.district, lat: located?.lat ?? area.lat, lng: located?.lng ?? area.lng } } : {}),
      ...(!l ? { itemKind, saleFormat } : {}),
    };
    sending.current = true;
    save.mutate(body, { onSettled: () => { sending.current = false; } });
  };

  const options = (categories.data ?? []).filter((c) => c.itemKind === itemKind);
  const commission = saleFormat === 'fixed_price' ? commissionOf(price, terms.commissionBps) : null;
  return (
    <form onSubmit={submit} noValidate className={`${styles.panel} ${styles.form}`} aria-labelledby="details-title">
      <h2 id="details-title">{t('sell.details')}</h2>
      {errors.length > 0 && (
        <div role="alert" className={styles.errors}>
          <p>{t('sell.fix')}</p>
          <ul>{errors.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {!l && (
        <fieldset className={styles.choice}>
          <legend>{t('sell.kind')}</legend>
          {(['physical', 'game_account'] as const).map((k) => (
            <div key={k}>
              <input id={`kind-${k}`} type="radio" name="kind" checked={itemKind === k} onChange={() => { setItemKind(k); setCategoryId(''); }} />
              <label htmlFor={`kind-${k}`}>{t(`sell.kind.${k}`)}</label>
            </div>
          ))}
          {game && <p className={styles.hint}>{t('sell.game.kind_hint')}</p>}
        </fieldset>
      )}
      {!l && (
        <fieldset className={styles.choice}>
          <legend>{t('sell.format')}</legend>
          {(['fixed_price', 'auction'] as const).map((f) => (
            <div key={f}>
              <input id={`format-${f}`} type="radio" name="format" checked={saleFormat === f} onChange={() => setSaleFormat(f)} />
              <label htmlFor={`format-${f}`}>{t(`sell.format.${f}`)}</label>
            </div>
          ))}
        </fieldset>
      )}
      {draft && (
        <>
          <label htmlFor="category">{t('sell.field.categoryId')}</label>
          <select id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-describedby="category-hint">
            <option value="">{t('sell.category_choose')}</option>
            {options.map((c) => (
              <option key={c.id} value={String(c.id)} disabled={!c.selectable}>
                {(lang === 'bn' ? c.nameBn : c.nameEn) + (c.selectable ? '' : ` (${t('sell.prohibited')})`)}
              </option>
            ))}
          </select>
          <p id="category-hint" className={styles.hint}>{t('sell.prohibited_policy')} <Link to="/help/terms">{t('sell.policy_link')}</Link></p>
        </>
      )}
      <label htmlFor="title">{t('sell.field.title')}</label>
      <input id="title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="description">{t('sell.field.description')}</label>
      <textarea id="description" value={description} rows={6} maxLength={5000} onChange={(e) => setDescription(e.target.value)} aria-describedby="description-hint" />
      <p id="description-hint" className={styles.hint}>{t('sell.description_hint')}</p>
      {!game && (
        <>
          <label htmlFor="condition">{t('sell.field.condition')}</label>
          <select id="condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">{t('sell.choose')}</option>
            {CONDITIONS.map((c) => <option key={c} value={c}>{t(`sell.condition.${c}`)}</option>)}
          </select>
          <div className={styles.check}>
            <input id="no-defects" type="checkbox" checked={noDefects} onChange={(e) => setNoDefects(e.target.checked)} />
            <label htmlFor="no-defects">{t('sell.no_defects')}</label>
          </div>
          {!noDefects && <p className={styles.hint}>{t('sell.defects_hint')}</p>}
          <label htmlFor="fulfilment">{t('sell.field.fulfilmentOptions')}</label>
          <select id="fulfilment" value={fulfilment} onChange={(e) => setFulfilment(e.target.value)}>
            {FULFILMENT.map((f) => <option key={f} value={f}>{t(`sell.fulfilment.${f}`)}</option>)}
          </select>
          {courier && (
            <>
              <label htmlFor="weight">{t('sell.field.weightClass')}</label>
              <select id="weight" value={weight} onChange={(e) => setWeight(e.target.value)}>
                <option value="">{t('sell.choose')}</option>
                {WEIGHTS.map((w) => <option key={w} value={w}>{t(`sell.weight.${w}`)}</option>)}
              </select>
              <label htmlFor="size">{t('sell.field.sizeClass')}</label>
              <select id="size" value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="">{t('sell.choose')}</option>
                {SIZES.map((s) => <option key={s} value={s}>{t(`sell.size.${s}`)}</option>)}
              </select>
            </>
          )}
        </>
      )}
      {saleFormat === 'fixed_price' && (
        <>
          <label htmlFor="price">{t('sell.field.price')}</label>
          <input id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-describedby="price-hint" />
          <p id="price-hint" className={styles.hint}>
            {commission
              ? t('sell.commission_fixed', { percent: percentOf(terms.commissionBps, lang), amount: formatMoney(commission, lang) })
              : t('sell.commission', { percent: percentOf(terms.commissionBps, lang) })}
          </p>
          {!game && (
            <>
              <label htmlFor="quantity">{t('sell.field.quantity')}</label>
              <input id="quantity" inputMode="numeric" value={quantity} maxLength={4} onChange={(e) => setQuantity(e.target.value)} />
            </>
          )}
        </>
      )}
      {saleFormat === 'auction' && <p className={styles.hint}>{t('sell.commission', { percent: percentOf(terms.commissionBps, lang) })}</p>}
      {!game && (
        <>
          <label htmlFor="area">{t('sell.field.area')}</label>
          <select id="area" value={areaId} onChange={(e) => { setAreaId(e.target.value); setLocated(null); }} aria-describedby="area-hint">
            <option value="">{l?.own?.area ? t('sell.area_keep', { district: l.own.area.district }) : t('sell.area_choose')}</option>
            {(areas.data?.items ?? []).map((a) => <option key={a.id} value={String(a.id)}>{`${lang === 'bn' ? a.nameBn : a.nameEn}, ${a.district}`}</option>)}
          </select>
          <p id="area-hint" className={styles.hint}>{t('sell.area_hint')}</p>
          <p><button type="button" className={styles.secondary} onClick={locate} disabled={locating || !areas.data} aria-busy={locating}>{t('sell.use_location')}</button></p>
          {located && area && <p className={styles.hint}>{t('sell.located', { area: `${lang === 'bn' ? area.nameBn : area.nameEn}, ${area.district}` })}</p>}
        </>
      )}
      <div className={styles.buttons}>
        <button type="submit" className={styles.primary} disabled={save.isPending}>{t(l ? 'sell.save' : 'sell.create')}</button>
      </div>
    </form>
  );
}

const percentOf = (bps: number, lang: Lang) => toLocalDigits(String(bps / 100), lang);

function Photos({ l, terms, t, lang }: { l: EditableListing; terms: SellingTerms; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [defects, setDefects] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const left = terms.photos.max - l.photos.length;
  const refresh = () => queryClient.invalidateQueries({ queryKey: listingKey(l.id) });

  const upload = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setMessage(null);
    if (files.length > left) return setMessage(t('sell.photos_too_many', { left: toLocalDigits(String(left), lang) }));
    const refused: string[] = [];
    for (const [i, f] of files.entries()) {
      setProgress(t('sell.photo_progress', { n: toLocalDigits(String(i + 1), lang), of: toLocalDigits(String(files.length), lang), name: f.name }));
      if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > terms.photos.maxBytes) { refused.push(f.name); continue; }
      const form = new FormData();
      form.set('showsDefects', defects ? 'true' : 'false');
      form.set('photo', f, f.name);
      try {
        await api.post(`/listings/${encodeURIComponent(l.id)}/photos`, form);
      } catch {
        refused.push(f.name);
      }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    if (refused.length) setMessage(t('sell.photos_refused', { names: refused.join(', ') }));
    await refresh();
  };
  const remove = useMutation({
    mutationFn: (pid: string) => api.del(`/listings/${encodeURIComponent(l.id)}/photos/${encodeURIComponent(pid)}`),
    onSuccess: () => void refresh(),
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  return (
    <section aria-labelledby="photos-title" className={styles.panel}>
      <h2 id="photos-title">{t('sell.photos')}</h2>
      <p className={styles.hint}>{t('sell.photos_hint', { min: toLocalDigits(String(terms.photos.min), lang), max: toLocalDigits(String(terms.photos.max), lang) })}</p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <ul className={styles.photos}>
        {l.photos.map((p, i) => (
          <li key={p.id}>
            <img src={p.thumbUrl} alt={t('sell.photo_alt', { n: toLocalDigits(String(i + 1), lang) })} width={120} height={90} />
            {p.showsDefects && <span className={styles.tag}>{t('sell.shows_defects')}</span>}
            <button type="button" className={styles.secondary} disabled={remove.isPending} onClick={() => remove.mutate(p.id)}>
              {t('sell.remove_photo', { n: toLocalDigits(String(i + 1), lang) })}
            </button>
          </li>
        ))}
      </ul>
      {left > 0 && (
        <>
          <div className={styles.check}>
            <input id="shows-defects" type="checkbox" checked={defects} onChange={(e) => setDefects(e.target.checked)} />
            <label htmlFor="shows-defects">{t('sell.these_show_defects')}</label>
          </div>
          <label htmlFor="photo-files">{t('sell.add_photos', { left: toLocalDigits(String(left), lang) })}</label>
          <input ref={input} id="photo-files" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={progress !== null}
            onChange={(e) => void upload(e.target.files)} />
        </>
      )}
      {progress && <p role="status">{progress}</p>}
    </section>
  );
}

function Publish({ l, terms, t, lang }: { l: EditableListing; terms: SellingTerms; t: T; lang: Lang }) {
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
      {errors.length > 0 && <div role="alert" className={styles.errors}><ul>{errors.map((x) => <li key={x}>{x}</li>)}</ul></div>}
      {done && <FormMessage kind="success">{done}</FormMessage>}
      {auction && (
        <>
          <label htmlFor="start-price">{t('sell.start_price')}</label>
          <input id="start-price" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} />
          <label htmlFor="reserve-price">{t('sell.reserve_price')}</label>
          <input id="reserve-price" inputMode="decimal" value={reserve} onChange={(e) => setReserve(e.target.value)} aria-describedby="reserve-hint" />
          <p id="reserve-hint" className={styles.hint}>{t('sell.reserve_hint')}</p>
          <label htmlFor="duration">{t('sell.duration')}</label>
          <select id="duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
            {terms.auctionDurations.map((d) => <option key={d} value={d}>{durationLabel(d, t, lang)}</option>)}
          </select>
        </>
      )}
      {game && <p>{t(blocked ? 'sell.game.details_first' : 'sell.game.review_first')}</p>}
      <p>{t('sell.commission_payout', { percent: percentOf(terms.commissionBps, lang) })}</p>
      <p>{t(auction ? 'sell.fixed_after_publish_auction' : 'sell.fixed_after_publish')}</p>
      <div className={styles.buttons}>
        <button type="submit" className={styles.primary} disabled={publish.isPending || blocked}>{t('sell.publish')}</button>
      </div>
    </form>
  );
}

function Clarifications({ l, t, lang }: { l: EditableListing; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.post(`/listings/${encodeURIComponent(l.id)}/clarifications`, { body: body.trim() }),
    onSuccess: () => { setBody(''); setMessage(null); void queryClient.invalidateQueries({ queryKey: listingKey(l.id) }); },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  return (
    <section aria-labelledby="clarify-title" className={styles.panel}>
      <h2 id="clarify-title">{t('sell.clarifications')}</h2>
      <p className={styles.hint}>{t('sell.clarifications_hint')}</p>
      {l.clarifications.length > 0 && (
        <ul>{l.clarifications.map((c) => <li key={c.id}><span className={styles.hint}>{formatDateTime(Date.parse(c.at), lang)}:</span> {c.body}</li>)}</ul>
      )}
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <form noValidate className={styles.form} onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); else setMessage(t('sell.clarification_empty')); }}>
        <label htmlFor="clarification">{t('sell.add_clarification')}</label>
        <textarea id="clarification" value={body} rows={3} maxLength={1000} onChange={(e) => setBody(e.target.value)} />
        <div className={styles.buttons}><button type="submit" className={styles.primary} disabled={add.isPending}>{t('sell.send_clarification')}</button></div>
      </form>
    </section>
  );
}
