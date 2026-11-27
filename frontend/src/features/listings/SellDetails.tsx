import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, parseTaka } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { fieldErrors, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { commissionOf, nearestArea, reasonTexts, type Category, type EditableListing, type SellingTerms } from './sell';
import styles from './sell.module.css';
import { Button } from '../../shared/ui';
import { listingKey, percentOf } from './sellShared';
import { CONDITIONS, FULFILMENT, WEIGHTS, SIZES, useAreas } from './sellOptions';

export function DetailsForm({ l, terms, t, lang }: { l: EditableListing | null; terms: SellingTerms; t: T; lang: Lang }) {
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
  const [serial, setSerial] = useState('');
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
      () => {
        setLocating(false);
        setMessage(t('sell.location_unavailable'));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      (l ? api.patch(`/listings/${encodeURIComponent(l.id)}`, body) : api.post('/listings', body, { idempotent: true })) as Promise<EditableListing>,
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
    if (serial.trim() !== '' && !/^[A-Z0-9]{6,30}$/.test(serial.replace(/[\s-]/g, '').toUpperCase())) problems.push(t('sell.need.serial'));
    setErrors(problems);
    if (problems.length || sending.current) return;
    const body: Record<string, unknown> = {
      ...(draft ? { categoryId: Number(categoryId) } : {}),
      title: title.trim(),
      description: description.trim(),
      ...(game
        ? {}
        : {
            condition,
            noVisibleDefects: noDefects,
            ...(serial.trim() !== '' ? { serial: serial.trim() } : {}),
            fulfilmentOptions: fulfilment,
            weightClass: courier ? weight : null,
            sizeClass: courier ? size : null,
          }),
      ...(saleFormat === 'fixed_price' ? { price: String(poisha), quantity: game ? 1 : q } : {}),
      ...(area && !game ? { area: { district: area.district, lat: located?.lat ?? area.lat, lng: located?.lng ?? area.lng } } : {}),
      ...(!l ? { itemKind, saleFormat } : {}),
    };
    sending.current = true;
    save.mutate(body, {
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const options = (categories.data ?? []).filter((c) => c.itemKind === itemKind);
  const commission = saleFormat === 'fixed_price' ? commissionOf(price, terms.commissionBps) : null;
  return (
    <form onSubmit={submit} noValidate className={`${styles.panel} ${styles.form}`} aria-labelledby="details-title">
      <h2 id="details-title">{t('sell.details')}</h2>
      {errors.length > 0 && (
        <div role="alert" className={styles.errors}>
          <p>{t('sell.fix')}</p>
          <ul>
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {!l && (
        <fieldset className={styles.choice}>
          <legend>{t('sell.kind')}</legend>
          {(['physical', 'game_account'] as const).map((k) => (
            <div key={k}>
              <input
                id={`kind-${k}`}
                type="radio"
                name="kind"
                checked={itemKind === k}
                onChange={() => {
                  setItemKind(k);
                  setCategoryId('');
                }}
              />
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
          <p id="category-hint" className={styles.hint}>
            {t('sell.prohibited_policy')} <Link to="/help/terms">{t('sell.policy_link')}</Link>
          </p>
        </>
      )}
      <label htmlFor="title">{t('sell.field.title')}</label>
      <input id="title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="description">{t('sell.field.description')}</label>
      <textarea
        id="description"
        value={description}
        rows={6}
        maxLength={5000}
        onChange={(e) => setDescription(e.target.value)}
        aria-describedby="description-hint"
      />
      <p id="description-hint" className={styles.hint}>
        {t('sell.description_hint')}
      </p>
      {!game && (
        <>
          <label htmlFor="condition">{t('sell.field.condition')}</label>
          <select id="condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">{t('sell.choose')}</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`sell.condition.${c}`)}
              </option>
            ))}
          </select>
          <div className={styles.check}>
            <input id="no-defects" type="checkbox" checked={noDefects} onChange={(e) => setNoDefects(e.target.checked)} />
            <label htmlFor="no-defects">{t('sell.no_defects')}</label>
          </div>
          {!noDefects && <p className={styles.hint}>{t('sell.defects_hint')}</p>}
          {!game && draft && ['mobile-phones', 'laptops-computers'].includes(categories.data?.find((c) => String(c.id) === categoryId)?.slug ?? '') && (
            <>
              <label htmlFor="serial">{t('sell.field.serial')}</label>
              <input
                id="serial"
                value={serial}
                maxLength={40}
                autoComplete="off"
                inputMode="text"
                aria-describedby="serial-hint"
                onChange={(e) => setSerial(e.target.value)}
              />
              <p id="serial-hint" className={styles.hint}>
                {l?.serialLast4 ? t('sell.serial_saved', { last4: l.serialLast4 }) : t('sell.serial_hint')}
              </p>
            </>
          )}
          <label htmlFor="fulfilment">{t('sell.field.fulfilmentOptions')}</label>
          <select id="fulfilment" value={fulfilment} onChange={(e) => setFulfilment(e.target.value)}>
            {FULFILMENT.map((f) => (
              <option key={f} value={f}>
                {t(`sell.fulfilment.${f}`)}
              </option>
            ))}
          </select>
          {courier && (
            <>
              <label htmlFor="weight">{t('sell.field.weightClass')}</label>
              <select id="weight" value={weight} onChange={(e) => setWeight(e.target.value)}>
                <option value="">{t('sell.choose')}</option>
                {WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {t(`sell.weight.${w}`)}
                  </option>
                ))}
              </select>
              <label htmlFor="size">{t('sell.field.sizeClass')}</label>
              <select id="size" value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="">{t('sell.choose')}</option>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sell.size.${s}`)}
                  </option>
                ))}
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
          <select
            id="area"
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setLocated(null);
            }}
            aria-describedby="area-hint"
          >
            <option value="">{l?.own?.area ? t('sell.area_keep', { district: l.own.area.district }) : t('sell.area_choose')}</option>
            {(areas.data?.items ?? []).map((a) => (
              <option key={a.id} value={String(a.id)}>{`${lang === 'bn' ? a.nameBn : a.nameEn}, ${a.district}`}</option>
            ))}
          </select>
          <p id="area-hint" className={styles.hint}>
            {t('sell.area_hint')}
          </p>
          <p>
            <Button variant="secondary" type="button" onClick={locate} disabled={locating || !areas.data} aria-busy={locating}>
              {t('sell.use_location')}
            </Button>
          </p>
          {located && area && <p className={styles.hint}>{t('sell.located', { area: `${lang === 'bn' ? area.nameBn : area.nameEn}, ${area.district}` })}</p>}
        </>
      )}
      <div className={styles.buttons}>
        <Button variant="primary" type="submit" disabled={save.isPending}>
          {t(l ? 'sell.save' : 'sell.create')}
        </Button>
      </div>
    </form>
  );
}
