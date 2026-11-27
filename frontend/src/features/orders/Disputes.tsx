// Disputes on the order view (docs/design/08_frontend.pdf section 7.7; Unit 7 section 5; FR-DSP-01 to FR-DSP-11;
// U8-09). The buyer opens one from the order, with only the types allowed now (I-56), a description of at least 20
// characters and up to 10 images (CP-33), after confirm.open_dispute. The dispute tab shows the status, the seller's
// response deadline and the decision target as countdowns, both parties' statements, one's own evidence, and after
// the decision the outcome and its reason. Withdrawing states confirm.withdraw_dispute with the new auto-release time.
// The order's disputes come from GET /orders/{id}/disputes (both parties; Decisions log, U8-09).
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { Popup } from '../../shared/Popup';
import { ActionCell, PopupActions } from '../../shared/ui';
import { Moment } from '../../shared/Moment';
import { Terms } from './Terms';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { FRESHNESS } from '../../shared/query';
import { orderKey, type OrderView } from './model';
import styles from './orders.module.css';

export type DisputeType = 'not_as_described' | 'damaged' | 'not_received' | 'credentials_invalid' | 'seller_recovery' | 'other';
export type DisputeStatus = 'open' | 'awaiting_seller' | 'under_review' | 'awaiting_return' | 'decided' | 'withdrawn';
export interface DisputeSummary {
  id: string;
  type: DisputeType;
  status: DisputeStatus;
  openedAt: string;
  outcome: string | null;
  decidedAt: string | null;
  withdrawnAt: string | null;
  unseen?: number;
}
export interface DisputeView {
  id: string;
  orderId: string;
  role: 'buyer' | 'seller';
  type: DisputeType;
  status: DisputeStatus;
  description: string | null;
  openedAt: string;
  sellerDueAt: string;
  infoDueAt: string | null;
  reviewStartedAt: string | null;
  decisionTargetAt: string | null;
  outcome: null | {
    kind: 'release' | 'full_refund' | 'partial_refund' | 'refund_after_return';
    itemRefund: string | null;
    reason: string | null;
    decidedAt: string | null;
  };
  withdrawnAt: string | null;
  /** the seller's step while the item comes back (U10-23) */
  returnStep?: { manual: boolean; last4: string | null; check: 'none' | 'matched' | 'mismatch' } | null;
  statements: { party: 'buyer' | 'seller'; text: string | null; at: string }[];
  evidence: { id: string; mime: string; size: number; at: string; link: { url: string; expiresAt: string } | null }[];
}

/** CP-33: at most 10 evidence images per dispute, 10 MB each. */
export const MAX_FILES = 10;
export const MAX_BYTES = 10_485_760;
/** Up to two videos beside the photos, 50 MB each (Decisions log, U10-23). */
export const MAX_VIDEOS = 2;
export const MAX_VIDEO_BYTES = 52_428_800;
const IMAGE = /^image\/(jpeg|png|webp)$/;
const VIDEO = /^video\/(mp4|quicktime|webm)$/;
/** A file the dispute accepts: a photo up to 10 MB or a video up to 50 MB. */
export const usableEvidence = (f: { type: string; size: number }) =>
  (IMAGE.test(f.type) && f.size <= MAX_BYTES) || (VIDEO.test(f.type) && f.size <= MAX_VIDEO_BYTES);
const LIVE: DisputeStatus[] = ['open', 'awaiting_seller', 'under_review', 'awaiting_return'];
export const disputesKey = (orderId: string) => ['orders', orderId, 'disputes'] as const;
export const disputeKey = (id: string) => ['disputes', id] as const;

export function useOrderDisputes(o: OrderView) {
  const api = useApi();
  return useQuery({
    queryKey: disputesKey(o.id),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(o.id)}/disputes`, { signal }) as Promise<{ items: DisputeSummary[] }>,
    staleTime: FRESHNESS.money,
    retry: false,
    enabled: o.status === 'paid' || o.status === 'closed',
  });
}

export function useDispute(id: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: disputeKey(id ?? ''),
    queryFn: ({ signal }) => api.get(`/disputes/${encodeURIComponent(id ?? '')}`, { signal }) as Promise<DisputeView>,
    staleTime: FRESHNESS.money,
    retry: false,
    enabled: id !== null,
  });
}

/**
 * The dispute slot of the order page (rail, U10-23; the same slot in every state): before a dispute, the way to open one (greyed until it is allowed); after it,
 * a small block: its status, deadlines, a confirmation that what was sent arrived, the chat with TrustBazaar (a page of its own, where each party talks only to
 * TrustBazaar, never to the other party), adding a photo or video, and for the buyer the withdrawal. The text of the complaint is not repeated here.
 */
export function DisputeSlot({ o, items, t, lang }: { o: OrderView; items: DisputeSummary[]; t: T; lang: Lang }) {
  const latest = items[0] ?? null;
  const live = latest !== null && LIVE.includes(latest.status);
  const dispute = useDispute(latest?.id ?? null);
  const [sent, setSent] = useState<{ failed: string | null } | null>(null);
  const now = useServerNow();
  // a dispute is for what came (or did not come): only once the item is handed over or sent, or the seller's deadline has passed
  const received = o.deliveryEventAt !== null || (o.fulfilmentDueAt !== null && Date.parse(o.fulfilmentDueAt) < now);
  const d = dispute.data;
  const deadlines: [string, string | null][] =
    d && live
      ? [
          ['dispute.deadline.seller', d.status === 'open' ? d.sellerDueAt : null],
          ['dispute.deadline.info', d.status === 'awaiting_seller' ? d.infoDueAt : null],
          ['dispute.deadline.decision', d.decisionTargetAt],
        ]
      : [];
  return (
    <>
      {d && (
        <section aria-labelledby="dispute-slot-title" className={styles.panel}>
          <h2 id="dispute-slot-title">{t('dispute.slot_title')}</h2>
          <dl className={styles.statusGrid}>
            <div>
              <dt>{t('handover.status_label')}</dt>
              <dd>{t(`dispute.state.${d.status}`)}</dd>
            </div>
            <div>
              <dt>{t('dispute.type')}</dt>
              <dd>{t(`dispute.type.${d.type}`)}</dd>
            </div>
          </dl>
          {deadlines.some(([, at]) => at) && (
            <dl className={styles.deadlineGrid}>
              {deadlines
                .filter(([, at]) => at)
                .map(([key, at]) => (
                  <div key={key}>
                    <dt>{t(key)}</dt>
                    <dd>
                      <Moment at={Date.parse(at as string)} now={now} t={t} lang={lang} />
                    </dd>
                  </div>
                ))}
            </dl>
          )}
          {d.outcome && (
            <dl className={styles.statusGrid}>
              <div>
                <dt>{t('dispute.outcome_title')}</dt>
                <dd>{t(`dispute.outcome.${d.outcome.kind}`, { amount: d.outcome.itemRefund ? formatMoney(BigInt(d.outcome.itemRefund), lang) : '' })}</dd>
              </div>
            </dl>
          )}
          {sent &&
            live &&
            (sent.failed ? <FormMessage kind="error">{sent.failed}</FormMessage> : <FormMessage kind="success">{t('dispute.sent')}</FormMessage>)}
          <ActionCell as={Link} to={`/disputes/${encodeURIComponent(d.id)}`}>
            {t('dispute.open_chat')}
            {(latest?.unseen ?? 0) > 0 && (
              <>
                <span className={styles.badge} aria-hidden="true">
                  {toLocalDigits(String(latest?.unseen ?? 0), lang)}
                </span>
                <span className={styles.srOnly}>{t('dispute.unseen', { n: toLocalDigits(String(latest?.unseen ?? 0), lang) })}</span>
              </>
            )}
          </ActionCell>
        </section>
      )}
      {dispute.isError && <FormMessage kind="error">{errorText(dispute.error, t, lang)}</FormMessage>}
      {o.role === 'buyer' &&
        !live &&
        o.status === 'paid' &&
        (received ? (
          <OpenDispute o={o} t={t} lang={lang} onOpened={(failed) => setSent({ failed })} />
        ) : (
          <section aria-labelledby="open-dispute-title" className={styles.panel}>
            <h2 id="open-dispute-title">{t('dispute.slot_title')}</h2>
            <ActionCell disabled aria-describedby="dispute-not-yet">
              {t('dispute.open_button')}
            </ActionCell>
            <p id="dispute-not-yet" className={styles.hint}>
              {t('dispute.not_yet')}
            </p>
          </section>
        ))}
    </>
  );
}

function OpenDispute({ o, t, lang, onOpened }: { o: OrderView; t: T; lang: Lang; onOpened: (notice: string | null) => void }) {
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
    <section aria-labelledby="open-dispute-title" className={styles.panel}>
      <h2 id="open-dispute-title">{t('dispute.slot_title')}</h2>
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
    </section>
  );
}

export function useRefresh(d: DisputeView) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: disputeKey(d.id) });
    void queryClient.invalidateQueries({ queryKey: orderKey(d.orderId) });
  };
}

export function Withdraw({ d, o, t, lang }: { d: DisputeView; o: OrderView | null; t: T; lang: Lang }) {
  const api = useApi();
  const refresh = useRefresh(d);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const withdraw = useMutation({
    mutationFn: () => api.post(`/disputes/${encodeURIComponent(d.id)}/withdraw`, {}),
    onSuccess: () => {
      setConfirming(false);
      refresh();
    },
    onError: (e) => {
      setConfirming(false);
      setMessage(errorText(e, t, lang));
      refresh();
    },
  });
  const at = o?.escrow?.autoReleaseAt ? formatDateTime(Date.parse(o.escrow.autoReleaseAt), lang) : t('dispute.release_time_unknown');
  return (
    <div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <ActionCell onClick={() => setConfirming(true)}>{t('dispute.withdraw')}</ActionCell>
      {confirming && (
        <ConfirmDialog
          id="withdraw-dispute"
          title={t('dispute.withdraw')}
          busy={withdraw.isPending}
          confirmLabel={t('dispute.withdraw_button')}
          cancelLabel={t('actions.back')}
          onConfirm={() => withdraw.mutate()}
          onCancel={() => setConfirming(false)}
        >
          <p>{t('confirm.withdraw_dispute', { at })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
