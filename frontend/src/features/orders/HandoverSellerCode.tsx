// The seller's side of the handover: the photos of the item, the code the buyer reads out, and the two-step popup that takes both.
import { Popup } from '../../shared/Popup';
import { PopupActions } from '../../shared/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toAsciiDigits, toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { CodeField, FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { isApiError, problemName } from '../../shared/problems';
import { handoverKey, orderKey, type HandoverView, type OrderView } from './model';
import styles from './orders.module.css';

/** The seller's part of the handover, in two steps in a popup: first a photo of the item (taken there, before anything else), then the buyer's code.
 *  The page itself holds only the start of it and the photos already added. */
export function SellerCode({ o, h, t, lang }: { o: OrderView; h: HandoverView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const sending = useRef(false);
  const photos = h.photoCount ?? 0;
  const enter = useMutation({
    mutationFn: (c: string) => api.post(`/orders/${encodeURIComponent(o.id)}/handover-code`, { code: c }),
    onSuccess: () => {
      setCode('');
      setStep(0);
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
    onError: (e) => {
      const wrong =
        isApiError(e) && problemName(e) === 'delivery-refused'
          ? (Array.isArray(e.errors) ? (e.errors as { reason?: string; attemptsLeft?: number }[]) : []).find((x) => x.reason === 'wrong_code')
          : undefined;
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
    onSuccess: () => {
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: handoverKey(o.id) });
    },
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
    enter.mutate(c, {
      onSettled: () => {
        sending.current = false;
      },
    });
  };
  const close = () => {
    setStep(0);
    setMessage(null);
  };
  const names = [t('handover.photos_label'), t('handover.code_field')];
  return (
    <>
      <div className={styles.code}>
        <h3>{t('handover.enter_title')}</h3>
        <p>{t('handover.enter_note')}</p>
        <button
          type="button"
          className={styles.primary}
          onClick={() => {
            setMessage(null);
            setStep(1);
          }}
        >
          {t('handover.start')}
        </button>
      </div>
      {step > 0 && (
        <Popup id="seller-code" title={t('handover.enter_title')} closeLabel={t('actions.back')} busy={enter.isPending || photo.isPending} onClose={close}>
          <div className={styles.hoStepper}>
            <p>
              <strong>{t('handover.step_of', { n: toLocalDigits(String(step), lang), total: toLocalDigits('2', lang) })}</strong> · {names[step - 1]}
            </p>
            <ol aria-hidden="true">
              {names.map((n, i) => (
                <li key={n} data-state={i + 1 < step ? 'done' : i + 1 === step ? 'now' : 'next'} />
              ))}
            </ol>
          </div>
          {message && <FormMessage kind="error">{message}</FormMessage>}
          {step === 1 ? (
            <div className={styles.hoStep}>
              <p className={styles.hint}>{t('handover.photo_hint')}</p>
              <div className={styles.photoCell}>
                <input
                  id="handover-photo"
                  className={styles.fileHidden}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  disabled={photo.isPending || photos >= 3}
                  onChange={(e) => picked(e.target.files, e.target)}
                />
                <label htmlFor="handover-photo">
                  <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">
                    <path
                      d="M3 8.5a2 2 0 0 1 2-2h2.2l1.3-2h7l1.3 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                    />
                    <circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
                  </svg>
                  <span>{t('handover.photo_add')}</span>
                </label>
                <strong aria-label={t('handover.photos_label')}>{toLocalDigits(String(photos), lang)} / 3</strong>
              </div>
              <PopupActions>
                <button
                  type="button"

                  disabled={photo.isPending}
                  onClick={() => {
                    setMessage(null);
                    setStep(2);
                  }}
                >
                  {t('dispute.continue')}
                </button>
                <button type="button" disabled={photo.isPending} onClick={close}>
                  {t('actions.back')}
                </button>
              </PopupActions>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className={styles.hoStep}>
              <p>{t('handover.enter_note')}</p>
              <CodeField
                id="handover-code"
                label={t('handover.code_field')}
                value={code}
                onChange={setCode}
                data-autofocus
                aria-describedby="handover-attempts"
              />
              <p id="handover-attempts" className={styles.hint}>
                {t('handover.attempts_left', { left: toLocalDigits(String(h.attemptsLeft ?? 0), lang) })}
              </p>
              <PopupActions>
                <button type="submit" disabled={enter.isPending}>
                  {t('handover.enter_button')}
                </button>
                <button
                  type="button"

                  disabled={enter.isPending}
                  onClick={() => {
                    setMessage(null);
                    setStep(1);
                  }}
                >
                  {t('actions.back')}
                </button>
              </PopupActions>
            </form>
          )}
        </Popup>
      )}
    </>
  );
}
