// Courier delivery before payment (docs/design/08_frontend.pdf section 7.4; Unit 4 sections 3.2, 6.2; FR-DLV-02,
// DV-23; U8-06): the buyer chooses a saved drop-off address or adds one, gets a binding quote whose expiry is shown
// as a countdown, then chooses courier with that quote (PUT /orders/{id}/fulfilment). While the courier service is
// unavailable (503 courier-unavailable) the buyer is told so and can pick the item up instead. Saved addresses are
// the user's own (FR-DLV-07); the area is chosen from Unit 4's list.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { addressesKey, areasKey, orderKey, type Area, type OrderView, type Quote, type SavedAddress } from './model';
import { Popup } from '../../shared/Popup';
import { PopupActions } from '../../shared/ui';
import { TimeLeft } from '../../shared/Moment';
import { Terms } from './Terms';
import styles from './orders.module.css';

export function useAddresses() {
  const api = useApi();
  return useQuery({
    queryKey: addressesKey,
    queryFn: ({ signal }) => api.get('/me/addresses', { signal }) as Promise<{ items: SavedAddress[] }>,
    staleTime: FRESHNESS.account,
  });
}

function useAreas() {
  const api = useApi();
  return useQuery({
    queryKey: areasKey,
    queryFn: ({ signal }) => api.get('/delivery/areas', { signal }) as Promise<{ items: Area[] }>,
    staleTime: FRESHNESS.reference,
  });
}

export function AddressForm({
  kind,
  t,
  lang,
  onSaved,
  onCancel,
}: {
  kind: 'pickup' | 'dropoff';
  t: T;
  lang: Lang;
  onSaved: (a: SavedAddress) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const areas = useAreas();
  const [label, setLabel] = useState('');
  const [areaId, setAreaId] = useState('');
  const [line1, setLine1] = useState('');
  const [landmark, setLandmark] = useState('');
  const [contactName, setContactName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.post('/me/addresses', {
        kind,
        label: label.trim(),
        areaId: Number(areaId),
        line1: line1.trim(),
        contactName: contactName.trim(),
        ...(landmark.trim() ? { landmark: landmark.trim() } : {}),
      }) as Promise<SavedAddress>,
    onSuccess: (a) => {
      void queryClient.invalidateQueries({ queryKey: addressesKey });
      onSaved(a);
    },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!label.trim() || !areaId || !line1.trim() || !contactName.trim()) return setMessage(t('address.missing'));
    setMessage(null);
    save.mutate();
  };
  const p = `address-${kind}`;
  return (
    <form onSubmit={submit} noValidate className={styles.form} aria-labelledby={`${p}-title`}>
      <h4 id={`${p}-title`} className={styles.srOnly}>
        {t(`address.new.${kind}`)}
      </h4>
      <p className={styles.hint}>{t('address.private')}</p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <label htmlFor={`${p}-label`}>{t('address.label')}</label>
      <input id={`${p}-label`} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      <label htmlFor={`${p}-area`}>{t('address.area')}</label>
      <select id={`${p}-area`} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
        <option value="">{t('address.area_choose')}</option>
        {(areas.data?.items ?? []).map((a) => (
          <option key={a.id} value={String(a.id)}>{`${lang === 'bn' ? a.nameBn : a.nameEn}, ${a.district}`}</option>
        ))}
      </select>
      <label htmlFor={`${p}-line1`}>{t('address.line1')}</label>
      <input id={`${p}-line1`} value={line1} maxLength={120} autoComplete="street-address" onChange={(e) => setLine1(e.target.value)} />
      <label htmlFor={`${p}-landmark`}>{t('address.landmark')}</label>
      <input id={`${p}-landmark`} value={landmark} maxLength={120} onChange={(e) => setLandmark(e.target.value)} />
      <label htmlFor={`${p}-contact`}>{t('address.contact')}</label>
      <input id={`${p}-contact`} value={contactName} maxLength={80} autoComplete="name" onChange={(e) => setContactName(e.target.value)} />
      <PopupActions>
        <button type="submit" disabled={save.isPending}>
          {t('address.save')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('actions.back')}
        </button>
      </PopupActions>
    </form>
  );
}

export function CourierChoice({ o, t, lang, disabled, onDone }: { o: OrderView; t: T; lang: Lang; disabled: boolean; onDone?: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const now = useServerNow();
  const addresses = useAddresses();
  const [chosen, setChosen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [terms, setTerms] = useState(false);
  const failed = (e: unknown) => {
    const name = problemName(e);
    setMessage(name === 'courier-unavailable' ? t('courier.unavailable') : name === 'feature-off' ? t('courier.off') : errorText(e, t, lang));
  };
  const ask = useMutation({
    mutationFn: (addressId: string) => api.post('/delivery/quotes', { listingId: o.listing.id, quantity: o.quantity, addressId }) as Promise<Quote>,
    onSuccess: (q) => {
      setMessage(null);
      setQuote(q);
    },
    onError: failed,
  });
  const choose = useMutation({
    mutationFn: (q: Quote) => api.put(`/orders/${encodeURIComponent(o.id)}/fulfilment`, { fulfilment: 'courier', quoteId: q.id }) as Promise<OrderView>,
    onSuccess: (next) => {
      queryClient.setQueryData(orderKey(o.id), next);
      setTerms(false);
      onDone?.();
    },
    onError: (e) => {
      setQuote(null);
      setTerms(false);
      failed(e);
    },
  });
  const drops = (addresses.data?.items ?? []).filter((a) => a.kind === 'dropoff');
  const selected = chosen ?? drops[0]?.id ?? null;
  const left = quote ? Date.parse(quote.expiresAt) - now : 0;
  const expired = quote !== null && left <= 0;
  return (
    <div className={styles.courier}>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {drops.length > 0 && (
        <fieldset className={styles.choice}>
          <legend>{t('courier.address')}</legend>
          {drops.map((a) => (
            <div key={a.id}>
              <input
                id={`drop-${a.id}`}
                type="radio"
                name="dropoff"
                checked={selected === a.id}
                onChange={() => {
                  setChosen(a.id);
                  setQuote(null);
                }}
              />
              <label htmlFor={`drop-${a.id}`}>
                {a.label}: {a.line1}, {lang === 'bn' ? a.area.nameBn : a.area.nameEn}, {a.area.district}
              </label>
            </div>
          ))}
        </fieldset>
      )}
      <button type="button" className={`${styles.secondary} ${styles.cellButton}`} onClick={() => setAdding(true)}>
        {t('address.add')}
      </button>
      {adding && (
        <Popup id="address-dropoff-popup" title={t('address.new.dropoff')} closeLabel={t('actions.back')} onClose={() => setAdding(false)}>
          <AddressForm
            kind="dropoff"
            t={t}
            lang={lang}
            onSaved={(a) => {
              setAdding(false);
              setChosen(a.id);
              setQuote(null);
            }}
            onCancel={() => setAdding(false)}
          />
        </Popup>
      )}
      {selected && !quote && (
        <button type="button" className={`${styles.secondary} ${styles.cellButton}`} disabled={disabled || ask.isPending} onClick={() => ask.mutate(selected)}>
          {t('courier.get_quote')}
        </button>
      )}
      {quote && (
        <div className={styles.quoteBlock}>
          <dl className={styles.quoteGrid}>
            <div>
              <dt>{t('courier.fee_label')}</dt>
              <dd>{formatMoney(BigInt(quote.fee), lang)}</dd>
            </div>
            <div>
              <dt>{t('courier.valid_label')}</dt>
              <dd>
                <TimeLeft at={Date.parse(quote.expiresAt)} now={now} t={t} lang={lang} label={false} />
              </dd>
            </div>
          </dl>
          {expired ? (
            <button
              type="button"
              className={`${styles.secondary} ${styles.cellButton}`}
              disabled={disabled || ask.isPending}
              onClick={() => selected && ask.mutate(selected)}
            >
              {t('courier.requote')}
            </button>
          ) : (
            <button type="button" className={`${styles.secondary} ${styles.cellButton}`} disabled={disabled || choose.isPending} onClick={() => setTerms(true)}>
              {t('courier.choose', { fee: formatMoney(BigInt(quote.fee), lang) })}
            </button>
          )}
        </div>
      )}
      {terms && quote && (
        <Terms
          id="courier-terms"
          t={t}
          lang={lang}
          order={o.id}
          kind="courier"
          title={t('courier.terms_title')}
          intro={t('courier.terms_intro')}
          prefix="courier.terms"
          count={8}
          check={t('courier.terms_check')}
          agree={t('courier.agree')}
          back={t('actions.back')}
          busy={choose.isPending}
          onAgree={() => choose.mutate(quote)}
          onClose={() => setTerms(false)}
        />
      )}
    </div>
  );
}
