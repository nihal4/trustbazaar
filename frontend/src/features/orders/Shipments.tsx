// The shipments of a courier order (docs/design/08_frontend.pdf section 7.5; Unit 4 sections 3.2 and 7.2;
// FR-DLV-07, FR-DLV-10, FR-DLV-14; NFR-CMP-05; U8-06): each shipment's status and history, the "simulated" banner on a
// mock shipment, "no cash to collect", the caller's own address and only the other party's district. The seller gives
// the pickup address while the shipment is preparing, and confirms a returned item has arrived.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { FRESHNESS } from '../../shared/query';
import { Popup } from '../../shared/Popup';
import { DateCells } from '../../shared/Moment';
import { SimulatedBanner } from '../../shared/SimulatedBanner';
import { AddressForm, useAddresses } from './Courier';
import { orderKey, shipmentsKey, type OrderView, type SavedAddress, type Shipment } from './model';
import styles from './orders.module.css';

export function useShipments(o: OrderView) {
  const api = useApi();
  return useQuery({
    queryKey: shipmentsKey(o.id),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(o.id)}/shipments`, { signal }) as Promise<{ items: Shipment[] }>,
    staleTime: FRESHNESS.money,
    retry: false,
    enabled: o.fulfilment === 'courier' && (o.status === 'paid' || o.status === 'closed'),
  });
}

const areaName = (a: { district: string; nameEn: string; nameBn: string }, lang: Lang) => `${lang === 'bn' ? a.nameBn : a.nameEn}, ${a.district}`;

export function Shipments({ o, items, t, lang }: { o: OrderView; items: Shipment[]; t: T; lang: Lang }) {
  return (
    <section aria-labelledby="shipments-title" className={styles.panel}>
      <h2 id="shipments-title">{t('shipments.title')}</h2>
      {items.some((s) => s.simulated) && <SimulatedBanner kind="courier" />}
      {items.length === 0 && <p className={styles.hint}>{t('shipments.none')}</p>}
      {items.map((s) => <ShipmentCard key={s.id} o={o} s={s} t={t} lang={lang} />)}
    </section>
  );
}

function ShipmentCard({ o, s, t, lang }: { o: OrderView; s: Shipment; t: T; lang: Lang }) {
  const seller = o.role === 'seller';
  return (
    <article className={styles.shipment} aria-label={t(`shipments.direction.${s.direction}`)}>
      <h3 className={styles.srOnly}>{t(`shipments.direction.${s.direction}`)}: {t(`shipments.status.${s.status}`)}</h3>
      <dl className={styles.shipFacts}>
        <div className={styles.statusCell}><dt>{t(`shipments.direction.${s.direction}`)}</dt><dd>{t(`shipments.status.${s.status}`)}</dd></div>
        <div><dt>{t('shipments.fee')}</dt><dd>{formatMoney(BigInt(s.fee), lang)}</dd></div>
        {s.consignmentId && <div><dt>{t('shipments.consignment')}</dt><dd className={styles.wrap}>{s.consignmentId}</dd></div>}
        {s.pickupDueAt && <div><dt>{t('shipments.pickup_due')}</dt><dd><DateCells at={Date.parse(s.pickupDueAt)} t={t} lang={lang} label={false} /></dd></div>}
        {s.failedAttempts > 0 && <div><dt>{t('shipments.failed_attempts')}</dt><dd>{toLocalDigits(String(s.failedAttempts), lang)}</dd></div>}
        {s.myAddress && (
          <div className={styles.wideCell}>
            <dt>{t('shipments.my_address')}</dt>
            <dd>{[s.myAddress.contactName, s.myAddress.line1, s.myAddress.line2, s.myAddress.landmark, areaName(s.myAddress.area, lang)].filter(Boolean).join(', ')}</dd>
          </div>
        )}
        {s.other.district && <div><dt>{t(seller ? 'shipments.buyer_district' : 'shipments.seller_district')}</dt><dd>{s.other.district}</dd></div>}
      </dl>
      {seller && s.direction === 'forward' && s.needsPickupAddress && <PickupAddress o={o} t={t} lang={lang} />}
      {seller && s.direction === 'return' && s.status !== 'cancelled' && <ReturnReceived o={o} t={t} lang={lang} />}
    </article>
  );
}

/** The status history of the shipment: one cell in the rail that opens it as a ruled list in a popup. */
export function ShipmentHistory({ items, t, lang }: { items: Shipment[]; t: T; lang: Lang }) {
  const [open, setOpen] = useState(false);
  const s = items.find((x) => x.history.length > 0);
  if (!s) return null;
  return (
    <div className={styles.historyCell}>
      <button type="button" className={`${styles.secondary} ${styles.cellButton}`} onClick={() => setOpen(true)}>{t('shipments.history')}</button>
      {open && (
        <Popup id={`history-${s.id}`} title={t('shipments.history')} closeLabel={t('actions.back')} onClose={() => setOpen(false)}>
          <ol className={styles.ruledList} role="list">
            {s.history.map((h, i) => <li key={i}><span>{t(`shipments.status.${h.to}`)}</span><DateCells at={Date.parse(h.at)} t={t} lang={lang} label={false} /></li>)}
          </ol>
        </Popup>
      )}
    </div>
  );
}

/** Section 7.2, step 1: the seller's saved pickup address; a new one can be added here. */
function PickupAddress({ o, t, lang }: { o: OrderView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const addresses = useAddresses();
  const [chosen, setChosen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: (addressId: string) => api.put(`/orders/${encodeURIComponent(o.id)}/shipment/pickup-address`, { addressId }),
    onSuccess: () => {
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: shipmentsKey(o.id) });
    },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const pickups = (addresses.data?.items ?? []).filter((a) => a.kind === 'pickup');
  const selected = chosen ?? pickups[0]?.id ?? null;
  return (
    <div className={styles.form}>
      <h4>{t('shipments.pickup_title')}</h4>
      <p>{t('shipments.pickup_note')}</p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {pickups.length > 0 && (
        <fieldset className={styles.choice}>
          <legend>{t('shipments.pickup_choose')}</legend>
          {pickups.map((a: SavedAddress) => (
            <div key={a.id}>
              <input id={`pickup-${a.id}`} type="radio" name="pickup" checked={selected === a.id} onChange={() => setChosen(a.id)} />
              <label htmlFor={`pickup-${a.id}`}>{a.label}: {a.line1}, {areaName(a.area, lang)}</label>
            </div>
          ))}
        </fieldset>
      )}
      <div className={styles.cellRow}>
        {selected && <button type="button" className={styles.primary} disabled={set.isPending} onClick={() => set.mutate(selected)}>{t('shipments.pickup_use')}</button>}
        <button type="button" className={styles.secondary} onClick={() => setAdding(true)}>{t('address.add')}</button>
      </div>
      {adding && (
        <Popup id="address-pickup-popup" title={t('address.new.pickup')} closeLabel={t('actions.back')} onClose={() => setAdding(false)}>
          <AddressForm kind="pickup" t={t} lang={lang} onSaved={(a) => { setAdding(false); setChosen(a.id); }} onCancel={() => setAdding(false)} />
        </Popup>
      )}
    </div>
  );
}

/** FR-DSP-06(d): the seller confirms the returned item arrived; once only. */
function ReturnReceived({ o, t, lang }: { o: OrderView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);
  const received = useMutation({
    mutationFn: () => api.post(`/orders/${encodeURIComponent(o.id)}/return/received`, {}),
    onSuccess: () => {
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: shipmentsKey(o.id) });
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
  });
  if (done) return <FormMessage kind="success">{t('shipments.return_noted')}</FormMessage>;
  return (
    <div>
      {received.isError && <FormMessage kind="error">{errorText(received.error, t, lang)}</FormMessage>}
      <button type="button" className={styles.secondary} disabled={received.isPending} onClick={() => received.mutate()}>{t('shipments.return_received')}</button>
    </div>
  );
}
