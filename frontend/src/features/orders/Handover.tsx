// The meetup handover (docs/design/08_frontend.pdf section 7.5; Unit 4 section 3.1; FR-DLV-03 to FR-DLV-06; U8-06).
// The buyer's code is hidden behind "Show code", large and readable aloud digit by digit, with its instruction
// (confirm.share_handover_code). The seller enters it, told to hand over the item only after the buyer gives it, with
// the attempts left before the lock. Proposals: a suggested public point (with a map link) or a place of the parties'
// own (a name and an optional pin from the device's position, never a map link, shown with a safety notice; Decisions
// log, U4-03). Times are Dhaka time.
import { Popup } from '../../shared/Popup';
import { DateCells } from '../../shared/Moment';
import { Terms } from './Terms';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toAsciiDigits, toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { CodeField, FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { isApiError, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { handoverKey, orderKey, type HandoverView, type MeetupPoint, type OrderView, type OwnPlace, type Proposal } from './model';
import styles from './orders.module.css';

export function useHandover(o: OrderView) {
  const api = useApi();
  const enabled = o.fulfilment === 'self_pickup' && (o.status === 'paid' || o.status === 'closed');
  return useQuery({
    queryKey: handoverKey(o.id),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(o.id)}/handover`, { signal }) as Promise<HandoverView>,
    staleTime: FRESHNESS.money,
    // Unit 4 creates the handover from the order's paid event, a moment after the payment (outbox): right after paying it
    // may not exist yet (the outbox is read every 5 seconds, DV-67), so a 404 is asked again for about 15 seconds instead of
    // being shown as an error (U8-11).
    retry: (count, e) => problemName(e) === 'not-found' && count < HANDOVER_RETRIES,
    retryDelay: 1500,
    enabled,
  });
}

export const HANDOVER_RETRIES = 10;

/** 'YYYY-MM-DDTHH:mm' typed as Dhaka time (UTC+6, no daylight saving) to an ISO instant; null when not a time. */
export function dhakaInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}:00+06:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** The code digit by digit, so it can be read aloud ("4 8 1 9 0 2"). */
export const spaced = (code: string, lang: Lang) => toLocalDigits(code.split('').join(' '), lang);

export function Handover({ o, h, t, lang, after, before }: { o: OrderView; h: HandoverView; t: T; lang: Lang; after?: ReactNode; before?: ReactNode }) {
  const open = h.status === 'arranging' || h.status === 'agreed';
  return (
    <section aria-labelledby="handover-title" className={styles.panel}>
      <h2 id="handover-title">{t('handover.title')}</h2>
      {before}
      <dl className={styles.statusGrid}>
        <div><dt>{t('handover.status_label')}</dt><dd>{t(`handover.state.${h.status}`)}</dd></div>
        {h.status === 'completed' && h.completedAt && <div><dt>{t('handover.done_label')}</dt><dd><DateCells at={Date.parse(h.completedAt)} t={t} lang={lang} label={false} /></dd></div>}
      </dl>
      {h.status === 'locked' && <FormMessage kind="error">{t('handover.locked')}</FormMessage>}
      {h.agreed && <Agreed a={h.agreed} t={t} lang={lang} />}
      {after}
      {open && h.role === 'buyer' && (h.code || h.deviceCheck) && <BuyerCode order={o.id} code={h.code} device={h.deviceCheck ?? null} t={t} lang={lang} />}
      {open && h.role === 'seller' && <SellerCode o={o} h={h} t={t} lang={lang} />}
      {open && <Proposals o={o} h={h} t={t} lang={lang} />}
    </section>
  );
}

function placeName(point: MeetupPoint | null, place: OwnPlace | null, lang: Lang): string {
  if (point) return `${lang === 'bn' ? point.nameBn : point.nameEn}, ${point.district}`;
  return place?.name ?? '';
}

/** A curated point has a map link; a place of the parties' own never has one, and carries the safety notice. */
function Where({ point, place, t, lang }: { point: MeetupPoint | null; place: OwnPlace | null; t: T; lang: Lang }) {
  return (
    <>
      <span>{placeName(point, place, lang)}</span>
      {point && <> · <a href={point.mapUrl} target="_blank" rel="noopener noreferrer">{t('handover.map')}</a></>}
      {point?.guidance && <span className={styles.hint}> · {point.guidance}</span>}
      {place && <span className={styles.notice}>{t('handover.own_place_notice')}</span>}
    </>
  );
}

function Agreed({ a, t, lang }: { a: NonNullable<HandoverView['agreed']>; t: T; lang: Lang }) {
  return (
    <dl className={styles.statusGrid}>
      <div><dt>{t('handover.place_label')}</dt><dd><Where point={a.point} place={a.place} t={t} lang={lang} /></dd></div>
      <div><dt>{t('handover.when_label')}</dt><dd><DateCells at={Date.parse(a.meetAt)} t={t} lang={lang} label={false} /></dd></div>
    </dl>
  );
}

/** The buyer's code: first the terms in a popup (check the item properly, what giving the code means), and only on agreeing the code in a second popup. */
function BuyerCode({ order, code, device, t, lang }: { order: string; code: string | null; device: NonNullable<HandoverView['deviceCheck']> | null; t: T; lang: Lang }) {
  const [step, setStep] = useState<'closed' | 'terms' | 'device' | 'code'>('closed');
  const needsDevice = device !== null && !device.matched;
  return (
    <>
    <div className={styles.code}>
      <h3>{t('handover.code_title')}</h3>
      <p>{t('confirm.share_handover_code')}</p>
      <button type="button" className={styles.primary} onClick={() => setStep('terms')}>{t('handover.show_code')}</button>
    </div>
    {step === 'terms' && (
      <Terms id="code-terms" t={t} lang={lang} order={order} kind="handover_code" title={t('handover.terms_title')} intro={t('handover.terms_intro')} prefix="handover.terms" count={7}
        check={t('handover.terms_check')} agree={t('handover.agree_show')} back={t('actions.back')} onAgree={() => setStep(needsDevice ? 'device' : 'code')} onClose={() => setStep('closed')} />
    )}
    {step === 'device' && device && <DeviceCheck order={order} device={device} t={t} lang={lang} onMatched={() => setStep('code')} onClose={() => setStep('closed')} />}
    {step === 'code' && (
      <Popup id="code-show" title={t('handover.code_title')} closeLabel={t('handover.hide_code')} onClose={() => setStep('closed')}>
        <p className={styles.codeNote}>{t('confirm.share_handover_code')}</p>
        <p className={`${styles.codeDigits} ${styles.codeCentre}`}>{code ? spaced(code, lang) : t('shell.loading')}</p>
        <div className={styles.popupButtons}>
          <button type="button" className={styles.secondary} onClick={() => setStep('closed')}>{t('handover.close_code')}</button>
        </div>
      </Popup>
    )}
    </>
  );
}

/** U10-23: before the code, the buyer types the identifier the device shows (*#06# on a phone); the server compares it with the listing's. */
function DeviceCheck({ order, device, t, lang, onMatched, onClose }: { order: string; device: NonNullable<HandoverView['deviceCheck']>; t: T; lang: Lang; onMatched: () => void; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const [left, setLeft] = useState(device.attemptsLeft);
  const [wrong, setWrong] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: () => api.post(`/orders/${encodeURIComponent(order)}/device-check`, { value: value.trim() }) as Promise<{ matched: boolean; attemptsLeft: number }>,
    onSuccess: (r) => {
      setLeft(r.attemptsLeft);
      if (r.matched) { void queryClient.invalidateQueries({ queryKey: handoverKey(order) }); onMatched(); } else { setWrong(true); setMessage(null); }
    },
    onError: (e) => setMessage(problemName(e) === 'validation-failed' && left <= 0 ? t('handover.device_locked') : errorText(e, t, lang)),
  });
  const locked = left <= 0;
  return (
    <Popup id="device-check" title={t('handover.device_title')} closeLabel={t('actions.back')} busy={check.isPending} onClose={onClose}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (value.trim().length >= 6 && !locked) check.mutate(); }}>
        {wrong && !locked && <FormMessage kind="error">{t('handover.device_wrong', { n: toLocalDigits(String(left), lang) })}</FormMessage>}
        {locked && <FormMessage kind="error">{t('handover.device_locked')}</FormMessage>}
        {message && <FormMessage kind="error">{message}</FormMessage>}
        <dl className={styles.statusGrid}>
          <div><dt>{t('handover.device_listing')}</dt><dd>•••• {device.last4}</dd></div>
        </dl>
        <label htmlFor="device-value">{t('handover.device_label')}</label>
        <input id="device-value" value={value} maxLength={40} autoComplete="off" disabled={locked} onChange={(e) => setValue(e.target.value)} />
        <div className={styles.popupButtons}>
          <button type="submit" className={styles.primary} disabled={check.isPending || locked || value.trim().length < 6}>{t('handover.device_check')}</button>
          <button type="button" className={styles.secondary} disabled={check.isPending} onClick={onClose}>{t('actions.back')}</button>
        </div>
      </form>
    </Popup>
  );
}

function SellerCode({ o, h, t, lang }: { o: OrderView; h: HandoverView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const sending = useRef(false);
  const enter = useMutation({
    mutationFn: (c: string) => api.post(`/orders/${encodeURIComponent(o.id)}/handover-code`, { code: c }),
    onSuccess: () => {
      setCode('');
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
    onError: (e) => {
      const wrong = isApiError(e) && problemName(e) === 'delivery-refused'
        ? (Array.isArray(e.errors) ? (e.errors as { reason?: string; attemptsLeft?: number }[]) : []).find((x) => x.reason === 'wrong_code') : undefined;
      setMessage(wrong ? t('handover.wrong_code', { left: toLocalDigits(String(wrong.attemptsLeft ?? 0), lang) }) : errorText(e, t, lang));
      void queryClient.invalidateQueries({ queryKey: handoverKey(o.id) });
    },
  });
  // U10-23: photos of the item taken at the meetup, before the code; they are evidence for a later dispute
  const photo = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.set('file', f, f.name);
      return api.post(`/orders/${encodeURIComponent(o.id)}/handover-photos`, form);
    },
    onSuccess: () => { setMessage(null); void queryClient.invalidateQueries({ queryKey: handoverKey(o.id) }); },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const picked = (list: FileList | null, input: HTMLInputElement) => {
    const f = list?.[0];
    input.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 10_485_760) return setMessage(t('handover.photo_invalid', { name: f.name }));
    photo.mutate(f);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = toAsciiDigits(code).replace(/\s+/g, '');
    if (!/^\d{4,12}$/.test(c)) return setMessage(t('handover.code_invalid'));
    if (sending.current) return;
    sending.current = true;
    setMessage(null);
    enter.mutate(c, { onSettled: () => { sending.current = false; } });
  };
  return (
    <form onSubmit={submit} noValidate className={styles.code}>
      <h3>{t('handover.enter_title')}</h3>
      <p>{t('handover.enter_note')}</p>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <dl className={styles.statusGrid}>
        <div><dt>{t('handover.photos_label')}</dt><dd>{toLocalDigits(String(h.photoCount ?? 0), lang)} / 3</dd></div>
      </dl>
      <label htmlFor="handover-photo">{t('handover.photo_add')}</label>
      <input id="handover-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={photo.isPending || (h.photoCount ?? 0) >= 3} onChange={(e) => picked(e.target.files, e.target)} />
      <p className={styles.hint}>{t('handover.photo_hint')}</p>
      <CodeField id="handover-code" label={t('handover.code_field')} value={code} onChange={setCode} aria-describedby="handover-attempts" />
      <p id="handover-attempts" className={styles.hint}>{t('handover.attempts_left', { left: toLocalDigits(String(h.attemptsLeft ?? 0), lang) })}</p>
      <button type="submit" className={styles.primary} disabled={enter.isPending}>{t('handover.enter_button')}</button>
    </form>
  );
}

function Proposals({ o, h, t, lang }: { o: OrderView; h: HandoverView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const respond = useMutation({
    mutationFn: ({ p, verb }: { p: Proposal; verb: 'accept' | 'decline' | 'withdraw' }) =>
      api.post(`/orders/${encodeURIComponent(o.id)}/meetup-proposals/${encodeURIComponent(p.id)}/${verb}`, {}) as Promise<HandoverView>,
    onSuccess: (next) => {
      setMessage(null);
      queryClient.setQueryData(handoverKey(o.id), next);
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
    onError: (e) => {
      setMessage(errorText(e, t, lang));
      void queryClient.invalidateQueries({ queryKey: handoverKey(o.id) });
    },
  });
  const current = h.proposals.find((p) => p.status === 'proposed');
  const past = h.proposals.filter((p) => p.status !== 'proposed' && p.status !== 'accepted');
  return (
    <div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {current && (
        <div className={styles.proposal}>
          <h3>{t(current.byMe ? 'handover.your_proposal' : 'handover.their_proposal')}</h3>
          <p><Where point={current.point} place={current.place} t={t} lang={lang} /></p>
          <dl className={styles.statusGrid}><div><dt>{t('handover.when_label')}</dt><dd><DateCells at={Date.parse(current.meetAt)} t={t} lang={lang} label={false} /></dd></div></dl>
          {current.note && <p>{t('handover.note_shown', { note: current.note })}</p>}
          <div className={styles.buttons}>
            {current.byMe
              ? <button type="button" className={styles.secondary} disabled={respond.isPending} onClick={() => respond.mutate({ p: current, verb: 'withdraw' })}>{t('handover.withdraw')}</button>
              : (
                <>
                  <button type="button" className={styles.primary} disabled={respond.isPending} onClick={() => respond.mutate({ p: current, verb: 'accept' })}>{t('handover.accept')}</button>
                  <button type="button" className={styles.secondary} disabled={respond.isPending} onClick={() => respond.mutate({ p: current, verb: 'decline' })}>{t('handover.decline')}</button>
                </>
              )}
          </div>
        </div>
      )}
      {past.length > 0 && (
        <details>
          <summary>{t('handover.history', { count: toLocalDigits(String(past.length), lang) })}</summary>
          <ul>
            {past.map((p) => (
              <li key={p.id}>
                {placeName(p.point, p.place, lang)}, {formatDateTime(Date.parse(p.meetAt), lang)}: {t(`handover.proposal.${p.status}`)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function ProposeForm({ o, h, t, lang }: { o: OrderView; h: HandoverView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [shown, setShown] = useState(false);
  const [where, setWhere] = useState<string>(h.suggestions[0]?.id ?? 'own');
  const [name, setName] = useState('');
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // the optional pin of an own place: the device's position, only after the button is pressed (IF-SW-08)
  const locate = () => {
    if (!('geolocation' in navigator)) return setMessage(t('handover.pin_unavailable'));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setPin({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }); },
      () => { setLocating(false); setMessage(t('handover.pin_unavailable')); },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  };
  const propose = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/orders/${encodeURIComponent(o.id)}/meetup-proposals`, body) as Promise<HandoverView>,
    onSuccess: (next) => {
      setShown(false);
      setName('');
      setWhen('');
      setNote('');
      setPin(null);
      setMessage(null);
      queryClient.setQueryData(handoverKey(o.id), next);
    },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const meetAt = dhakaInput(when);
    if (!meetAt) return setMessage(t('handover.time_needed'));
    const own = where === 'own';
    if (own && name.trim().length < 3) return setMessage(t('handover.place_needed'));
    const body: Record<string, unknown> = {
      meetAt, ...(own ? { placeName: name.trim(), ...(pin ? { placeLat: pin.lat, placeLng: pin.lng } : {}) } : { pointId: where }), ...(note.trim() ? { note: note.trim() } : {}),
    };
    propose.mutate(body);
  };
  const button = <div className={styles.actionCell}><button type="button" className={styles.secondary} onClick={() => setShown(true)}>{t(h.agreed ? 'handover.propose_other' : 'handover.propose')}</button></div>;
  if (!shown) return button;
  return (
    <>
    {button}
    <Popup id="propose" title={t('handover.propose')} closeLabel={t('actions.back')} busy={propose.isPending} onClose={() => setShown(false)}>
    <form onSubmit={submit} noValidate className={styles.form}>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <fieldset className={styles.choice}>
        <legend>{t('handover.where')}</legend>
        {h.suggestions.length === 0 && <p className={styles.hint}>{t('handover.no_suggestions')}</p>}
        {h.suggestions.map((p) => (
          <div key={p.id}>
            <input id={`point-${p.id}`} type="radio" name="where" value={p.id} checked={where === p.id} onChange={() => setWhere(p.id)} />
            <label htmlFor={`point-${p.id}`}>{placeName(p, null, lang)}</label>
            <a href={p.mapUrl} target="_blank" rel="noopener noreferrer">{t('handover.map')}</a>
          </div>
        ))}
        <div>
          <input id="point-own" type="radio" name="where" value="own" checked={where === 'own'} onChange={() => setWhere('own')} />
          <label htmlFor="point-own">{t('handover.own_place')}</label>
        </div>
      </fieldset>
      {where === 'own' && (
        <>
          <p className={styles.notice}>{t('handover.own_place_notice')}</p>
          <label htmlFor="place-name">{t('handover.place_name')}</label>
          <input id="place-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          {pin
            ? <p>{t('handover.pin_added')} <button type="button" className={styles.secondary} onClick={() => setPin(null)}>{t('handover.pin_remove')}</button></p>
            : <p><button type="button" className={styles.secondary} disabled={locating} aria-busy={locating} onClick={locate}>{t('handover.pin_add')}</button></p>}
        </>
      )}
      <label htmlFor="meet-at">{t('handover.when')}</label>
      <input id="meet-at" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-describedby="meet-at-hint" />
      <p id="meet-at-hint" className={styles.hint}>{t('handover.when_hint', { due: formatDateTime(Date.parse(h.dueAt), lang) })}</p>
      <label htmlFor="meet-note">{t('handover.note')}</label>
      <input id="meet-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      <div className={styles.popupButtons}>
        <button type="submit" className={styles.primary} disabled={propose.isPending}>{t('handover.send_proposal')}</button>
        <button type="button" className={styles.secondary} onClick={() => setShown(false)}>{t('actions.back')}</button>
      </div>
    </form>
    </Popup>
    </>
  );
}
