// Opening a dispute from the order: the allowed types, the description, up to 10 photos and 2 videos, then the terms to agree to (FR-DSP-01, CP-33).
import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { Popup } from '../../shared/Popup';
import { ActionCell, Panel, PopupActions } from '../../shared/ui';
import { Terms } from './Terms';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { FRESHNESS } from '../../shared/query';
import { MAX_FILES, MAX_VIDEOS, usableEvidence, VIDEO, type DisputeType } from './disputeModel';
import { orderKey, type OrderView } from './model';
import styles from './orders.module.css';

export function OpenDispute({ o, t, lang, onOpened }: { o: OrderView; t: T; lang: Lang; onOpened: (notice: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const types = useQuery({
    queryKey: ['orders', o.id, 'dispute-types'],
    queryFn: ({ signal }) =>
      api.get(`/orders/${encodeURIComponent(o.id)}/dispute-types`, { signal }) as Promise<{ types: DisputeType[]; openDisputeId: string | null }>,
    staleTime: FRESHNESS.money,
    retry: false,
  });
  const [shown, setShown] = useState(false);
  const [type, setType] = useState<DisputeType | null>(null);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const sending = useRef(false);
  const open = useMutation({
    mutationFn: async () => {
      const { disputeId } = (await api.post(
        `/orders/${encodeURIComponent(o.id)}/disputes`,
        { type, description: description.trim() },
        { idempotent: true },
      )) as { disputeId: string };
      // the files follow the dispute, one by one; a refused file does not undo the dispute
      const failed: string[] = [];
      for (const [i, f] of files.entries()) {
        setProgress(t('dispute.uploading', { n: toLocalDigits(String(i + 1), lang), of: toLocalDigits(String(files.length), lang) }));
        const form = new FormData();
        form.set('file', f, f.name);
        await api.post(`/disputes/${encodeURIComponent(disputeId)}/evidence`, form).catch(() => failed.push(f.name));
      }
      return { disputeId, failed };
    },
    onSuccess: ({ failed }) => {
      setConfirming(false);
      setShown(false);
      setProgress(null);
      onOpened(failed.length ? t('dispute.files_failed', { names: failed.join(', ') }) : null);
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
    onError: (e) => {
      setConfirming(false);
      setProgress(null);
      setMessage(errorText(e, t, lang));
      void queryClient.invalidateQueries({ queryKey: ['orders', o.id, 'dispute-types'] });
    },
  });
  const allowed = types.data?.types ?? [];
  if (!types.data || (allowed.length === 0 && !message)) return null;

  const pick = (list: FileList | null) => {
    const chosen = Array.from(list ?? []);
    const wrong = chosen.find((f) => !usableEvidence(f));
    if (wrong) return setMessage(t('dispute.file_invalid', { name: wrong.name }));
    if (chosen.length > MAX_FILES) return setMessage(t('dispute.too_many_files', { max: toLocalDigits(String(MAX_FILES), lang) }));
    if (chosen.filter((f) => VIDEO.test(f.type)).length > MAX_VIDEOS)
      return setMessage(t('dispute.too_many_videos', { max: toLocalDigits(String(MAX_VIDEOS), lang) }));
    setMessage(null);
    setFiles(chosen);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!type) return setMessage(t('dispute.type_needed'));
    if (description.trim().length < 20) return setMessage(t('dispute.description_short'));
    setMessage(null);
    setConfirming(true);
  };
  const send = () => {
    if (sending.current) return;
    sending.current = true;
    open.mutate(undefined, {
      onSettled: () => {
        sending.current = false;
      },
    });
  };

  const closeForm = () => {
    setShown(false);
    setMessage(null);
  };
  return (
    <Panel title={t('dispute.slot_title')} className={styles.panel}>
      {message && !shown && <FormMessage kind="error">{message}</FormMessage>}
      <ActionCell onClick={() => setShown(true)}>{t('dispute.open_button')}</ActionCell>
      {shown && !confirming && (
        <Popup id="open-dispute-form" title={t('dispute.open_title')} closeLabel={t('actions.back')} busy={open.isPending} onClose={closeForm}>
          <form onSubmit={submit} noValidate className={styles.form}>
            {message && <FormMessage kind="error">{message}</FormMessage>}
            {o.fulfilment === 'self_pickup' && o.deliveryEventAt && <p className={styles.notice}>{t('dispute.latent_hint')}</p>}
            <fieldset className={styles.choice}>
              <legend>{t('dispute.type')}</legend>
              {allowed.map((k) => (
                <div key={k}>
                  <input id={`dispute-type-${k}`} type="radio" name="dispute-type" checked={type === k} onChange={() => setType(k)} />
                  <label htmlFor={`dispute-type-${k}`}>{t(`dispute.type.${k}`)}</label>
                </div>
              ))}
            </fieldset>
            <label htmlFor="dispute-description">{t('dispute.description')}</label>
            <textarea
              id="dispute-description"
              value={description}
              rows={4}
              maxLength={4000}
              aria-describedby="dispute-description-hint"
              onChange={(e) => setDescription(e.target.value)}
            />
            <p id="dispute-description-hint" className={styles.hint}>
              {t('dispute.description_hint')}
            </p>
            <label htmlFor="dispute-files">
              {t('dispute.files', { max: toLocalDigits(String(MAX_FILES), lang), videos: toLocalDigits(String(MAX_VIDEOS), lang) })}
            </label>
            <input
              id="dispute-files"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
              multiple
              aria-describedby="dispute-files-hint"
              onChange={(e) => pick(e.target.files)}
            />
            <p id="dispute-files-hint" className={styles.hint}>
              {t('dispute.files_hint')}
            </p>
            {files.length > 0 && <p className={styles.hint}>{t('dispute.files_chosen', { n: toLocalDigits(String(files.length), lang) })}</p>}
            {progress && <p role="status">{progress}</p>}
            <PopupActions>
              <button type="submit" disabled={open.isPending}>
                {t('dispute.continue')}
              </button>
              <button type="button" onClick={closeForm}>
                {t('actions.back')}
              </button>
            </PopupActions>
          </form>
        </Popup>
      )}
      {confirming && (
        <Terms
          id="open-dispute"
          t={t}
          lang={lang}
          order={o.id}
          kind="dispute"
          title={t('dispute.terms_title')}
          intro={t('dispute.terms_intro')}
          prefix="dispute.terms"
          count={8}
          check={t('dispute.terms_check')}
          agree={t('dispute.confirm_button')}
          back={t('actions.back')}
          busy={open.isPending}
          onAgree={send}
          onClose={() => setConfirming(false)}
        />
      )}
    </Panel>
  );
}
