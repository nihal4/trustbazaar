// The details form of a listing being sold: category, title, description, condition, how it is handed over, price or auction terms, and where the
// item is.
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { fieldErrors } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { commissionOf, nearestArea, reasonTexts, type Category, type EditableListing, type SellingTerms } from './sell';
import styles from './sell.module.css';
import { Button, Checkbox, Input, Radio, Select, Textarea } from '../../shared/ui';
import { detailsBody, detailsProblems, refusedMessage, type DetailsValues } from './sellDetailsBody';
import { AreaFields } from './SellArea';
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
      setMessage(refusedMessage(e, fields.length > 0, t, lang));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const values: DetailsValues = {
      draft,
      isNew: !l,
      game,
      courier,
      saleFormat,
      itemKind,
      categoryId,
      title,
      description,
      condition,
      noDefects,
      serial,
      fulfilment,
      weight,
      size,
      price,
      quantity,
      area,
      located,
    };
    const { problems, poisha } = detailsProblems(values, t);
    setErrors(problems);
    if (problems.length || sending.current) return;
    const body = detailsBody(values, poisha);
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
            <Radio
              key={k}
              id={`kind-${k}`}
              name="kind"
              checked={itemKind === k}
              onChange={() => {
                setItemKind(k);
                setCategoryId('');
              }}
              label={t(`sell.kind.${k}`)}
            />
          ))}
          {game && <p className={styles.hint}>{t('sell.game.kind_hint')}</p>}
        </fieldset>
      )}
      {!l && (
        <fieldset className={styles.choice}>
          <legend>{t('sell.format')}</legend>
          {(['fixed_price', 'auction'] as const).map((f) => (
            <Radio key={f} id={`format-${f}`} name="format" checked={saleFormat === f} onChange={() => setSaleFormat(f)} label={t(`sell.format.${f}`)} />
          ))}
        </fieldset>
      )}
      {draft && (
        <>
          <label htmlFor="category">{t('sell.field.categoryId')}</label>
          <Select block id="category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-describedby="category-hint">
            <option value="">{t('sell.category_choose')}</option>
            {options.map((c) => (
              <option key={c.id} value={String(c.id)} disabled={!c.selectable}>
                {(lang === 'bn' ? c.nameBn : c.nameEn) + (c.selectable ? '' : ` (${t('sell.prohibited')})`)}
              </option>
            ))}
          </Select>
          <p id="category-hint" className={styles.hint}>
            {t('sell.prohibited_policy')} <Link to="/help/terms">{t('sell.policy_link')}</Link>
          </p>
        </>
      )}
      <label htmlFor="title">{t('sell.field.title')}</label>
      <Input block id="title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="description">{t('sell.field.description')}</label>
      <Textarea
        block
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
          <Select block id="condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">{t('sell.choose')}</option>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {t(`sell.condition.${c}`)}
              </option>
            ))}
          </Select>
          <Checkbox id="no-defects" checked={noDefects} onChange={(e) => setNoDefects(e.target.checked)} label={t('sell.no_defects')} />
          {!noDefects && <p className={styles.hint}>{t('sell.defects_hint')}</p>}
          {!game && draft && ['mobile-phones', 'laptops-computers'].includes(categories.data?.find((c) => String(c.id) === categoryId)?.slug ?? '') && (
            <>
              <label htmlFor="serial">{t('sell.field.serial')}</label>
              <Input
                block
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
          <Select block id="fulfilment" value={fulfilment} onChange={(e) => setFulfilment(e.target.value)}>
            {FULFILMENT.map((f) => (
              <option key={f} value={f}>
                {t(`sell.fulfilment.${f}`)}
              </option>
            ))}
          </Select>
          {courier && (
            <>
              <label htmlFor="weight">{t('sell.field.weightClass')}</label>
              <Select block id="weight" value={weight} onChange={(e) => setWeight(e.target.value)}>
                <option value="">{t('sell.choose')}</option>
                {WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {t(`sell.weight.${w}`)}
                  </option>
                ))}
              </Select>
              <label htmlFor="size">{t('sell.field.sizeClass')}</label>
              <Select block id="size" value={size} onChange={(e) => setSize(e.target.value)}>
                <option value="">{t('sell.choose')}</option>
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sell.size.${s}`)}
                  </option>
                ))}
              </Select>
            </>
          )}
        </>
      )}
      {saleFormat === 'fixed_price' && (
        <>
          <label htmlFor="price">{t('sell.field.price')}</label>
          <Input block id="price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-describedby="price-hint" />
          <p id="price-hint" className={styles.hint}>
            {commission
              ? t('sell.commission_fixed', { percent: percentOf(terms.commissionBps, lang), amount: formatMoney(commission, lang) })
              : t('sell.commission', { percent: percentOf(terms.commissionBps, lang) })}
          </p>
          {!game && (
            <>
              <label htmlFor="quantity">{t('sell.field.quantity')}</label>
              <Input block id="quantity" inputMode="numeric" value={quantity} maxLength={4} onChange={(e) => setQuantity(e.target.value)} />
            </>
          )}
        </>
      )}
      {saleFormat === 'auction' && <p className={styles.hint}>{t('sell.commission', { percent: percentOf(terms.commissionBps, lang) })}</p>}
      {!game && (
        <AreaFields
          t={t}
          lang={lang}
          areas={areas.data?.items ?? []}
          ready={!!areas.data}
          keepDistrict={l?.own?.area?.district}
          areaId={areaId}
          onArea={(id) => {
            setAreaId(id);
            setLocated(null);
          }}
          area={area}
          located={located}
          locating={locating}
          onLocate={locate}
        />
      )}
      <div className={styles.buttons}>
        <Button variant="primary" type="submit" disabled={save.isPending}>
          {t(l ? 'sell.save' : 'sell.create')}
        </Button>
      </div>
    </form>
  );
}
