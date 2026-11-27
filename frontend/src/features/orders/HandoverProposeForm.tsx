import { Popup } from '../../shared/Popup';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { handoverKey, type HandoverView, type OrderView } from './model';
import styles from './orders.module.css';
import { dhakaInput, placeName } from './handoverShared';

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
      (p) => {
        setLocating(false);
        setPin({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 });
      },
      () => {
        setLocating(false);
        setMessage(t('handover.pin_unavailable'));
      },
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
      meetAt,
      ...(own ? { placeName: name.trim(), ...(pin ? { placeLat: pin.lat, placeLng: pin.lng } : {}) } : { pointId: where }),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    propose.mutate(body);
  };
  const button = (
    <div className={styles.actionCell}>
      <button type="button" className={styles.secondary} onClick={() => setShown(true)}>
        {t(h.agreed ? 'handover.propose_other' : 'handover.propose')}
      </button>
    </div>
  );
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
                <a href={p.mapUrl} target="_blank" rel="noopener noreferrer">
                  {t('handover.map')}
                </a>
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
              {pin ? (
                <p>
                  {t('handover.pin_added')}{' '}
                  <button type="button" className={styles.secondary} onClick={() => setPin(null)}>
                    {t('handover.pin_remove')}
                  </button>
                </p>
              ) : (
                <p>
                  <button type="button" className={styles.secondary} disabled={locating} aria-busy={locating} onClick={locate}>
                    {t('handover.pin_add')}
                  </button>
                </p>
              )}
            </>
          )}
          <label htmlFor="meet-at">{t('handover.when')}</label>
          <input id="meet-at" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-describedby="meet-at-hint" />
          <p id="meet-at-hint" className={styles.hint}>
            {t('handover.when_hint', { due: formatDateTime(Date.parse(h.dueAt), lang) })}
          </p>
          <label htmlFor="meet-note">{t('handover.note')}</label>
          <input id="meet-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <div className={styles.popupButtons}>
            <button type="submit" className={styles.primary} disabled={propose.isPending}>
              {t('handover.send_proposal')}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setShown(false)}>
              {t('actions.back')}
            </button>
          </div>
        </form>
      </Popup>
    </>
  );
}
