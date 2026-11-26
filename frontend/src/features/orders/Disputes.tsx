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
import { formatDateTime, formatDeadline } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { useServerNow } from '../../shared/clock';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { FRESHNESS } from '../../shared/query';
import { orderKey, type OrderView } from './model';
import styles from './orders.module.css';

export type DisputeType = 'not_as_described' | 'damaged' | 'not_received' | 'credentials_invalid' | 'seller_recovery' | 'other';
export type DisputeStatus = 'open' | 'awaiting_seller' | 'under_review' | 'awaiting_return' | 'decided' | 'withdrawn';
export interface DisputeSummary { id: string; type: DisputeType; status: DisputeStatus; openedAt: string; outcome: string | null; decidedAt: string | null; withdrawnAt: string | null }
export interface DisputeView {
  id: string; orderId: string; role: 'buyer' | 'seller'; type: DisputeType; status: DisputeStatus; description: string;
  openedAt: string; sellerDueAt: string; infoDueAt: string | null; reviewStartedAt: string | null; decisionTargetAt: string | null;
  outcome: null | { kind: 'release' | 'full_refund' | 'partial_refund' | 'refund_after_return'; itemRefund: string | null; reason: string | null; decidedAt: string | null };
  withdrawnAt: string | null;
  statements: { party: 'buyer' | 'seller'; text: string | null; at: string }[];
  evidence: { id: string; mime: string; size: number; at: string; link: { url: string; expiresAt: string } | null }[];
}

/** CP-33: at most 10 evidence images per dispute, 10 MB each. */
export const MAX_FILES = 10;
export const MAX_BYTES = 10_485_760;
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

/** The order view's dispute part: the latest dispute, and for the buyer the way to open one when allowed. */
export function Disputes({ o, items, t, lang }: { o: OrderView; items: DisputeSummary[]; t: T; lang: Lang }) {
  const latest = items[0] ?? null;
  const live = latest !== null && LIVE.includes(latest.status);
  const dispute = useDispute(latest?.id ?? null);
  // said after the opening form is gone: which photos did not follow the new dispute
  const [notice, setNotice] = useState<string | null>(null);
  // a dispute is for what came (or did not come): only once the item is handed over or sent, or the seller's deadline has passed
  const now = useServerNow();
  const received = o.deliveryEventAt !== null || (o.fulfilmentDueAt !== null && Date.parse(o.fulfilmentDueAt) < now);
  return (
    <>
      {notice && <FormMessage kind="error">{notice}</FormMessage>}
      {dispute.data && <DisputePanel d={dispute.data} o={o} t={t} lang={lang} />}
      {dispute.isError && <FormMessage kind="error">{errorText(dispute.error, t, lang)}</FormMessage>}
      {o.role === 'buyer' && !live && o.status === 'paid' && (received
        ? <OpenDispute o={o} t={t} lang={lang} onOpened={setNotice} />
        : <p className={styles.hint}>{t('dispute.not_yet')}</p>)}
    </>
  );
}

function OpenDispute({ o, t, lang, onOpened }: { o: OrderView; t: T; lang: Lang; onOpened: (notice: string | null) => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const types = useQuery({
    queryKey: ['orders', o.id, 'dispute-types'],
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(o.id)}/dispute-types`, { signal }) as Promise<{ types: DisputeType[]; openDisputeId: string | null }>,
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
      const { disputeId } = await api.post(`/orders/${encodeURIComponent(o.id)}/disputes`, { type, description: description.trim() }, { idempotent: true }) as { disputeId: string };
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
    const wrong = chosen.find((f) => !/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > MAX_BYTES);
    if (wrong) return setMessage(t('dispute.file_invalid', { name: wrong.name }));
    if (chosen.length > MAX_FILES) return setMessage(t('dispute.too_many_files', { max: toLocalDigits(String(MAX_FILES), lang) }));
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
    open.mutate(undefined, { onSettled: () => { sending.current = false; } });
  };

  return (
    <section aria-labelledby="open-dispute-title" className={styles.panel}>
      <h2 id="open-dispute-title">{t('dispute.open_title')}</h2>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {!shown
        ? (
          <>
            <p>{t('dispute.open_intro')}</p>
            <button type="button" className={styles.secondary} onClick={() => setShown(true)}>{t('dispute.open_button')}</button>
          </>
        )
        : (
          <form onSubmit={submit} noValidate className={styles.form}>
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
            <textarea id="dispute-description" value={description} rows={5} maxLength={4000} aria-describedby="dispute-description-hint"
              onChange={(e) => setDescription(e.target.value)} />
            <p id="dispute-description-hint" className={styles.hint}>{t('dispute.description_hint')}</p>
            <label htmlFor="dispute-files">{t('dispute.files', { max: toLocalDigits(String(MAX_FILES), lang) })}</label>
            <input id="dispute-files" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(e) => pick(e.target.files)} />
            {files.length > 0 && <p className={styles.hint}>{t('dispute.files_chosen', { n: toLocalDigits(String(files.length), lang) })}</p>}
            {progress && <p role="status">{progress}</p>}
            <div className={styles.buttons}>
              <button type="submit" className={styles.primary} disabled={open.isPending}>{t('dispute.continue')}</button>
              <button type="button" className={styles.secondary} onClick={() => setShown(false)}>{t('actions.back')}</button>
            </div>
          </form>
        )}
      {confirming && (
        <ConfirmDialog id="open-dispute" title={t('dispute.open_title')} busy={open.isPending}
          confirmLabel={t('dispute.confirm_button')} cancelLabel={t('actions.back')} onConfirm={send} onCancel={() => setConfirming(false)}>
          <p>{t('confirm.open_dispute')}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

export function DisputePanel({ d, o, t, lang }: { d: DisputeView; o: OrderView | null; t: T; lang: Lang }) {
  const now = useServerNow();
  const live = LIVE.includes(d.status);
  const deadlines: [string, string | null][] = live
    ? [
      ['dispute.deadline.seller', d.status === 'open' ? d.sellerDueAt : null],
      ['dispute.deadline.info', d.status === 'awaiting_seller' ? d.infoDueAt : null],
      ['dispute.deadline.decision', d.decisionTargetAt],
    ]
    : [];
  const outcome = d.outcome;
  return (
    <section aria-labelledby={`dispute-${d.id}`} className={styles.panel}>
      <h2 id={`dispute-${d.id}`}>{t('dispute.title', { type: t(`dispute.type.${d.type}`) })}</h2>
      <p><strong>{t(`dispute.status.${d.status}.${d.role}`)}</strong></p>
      <p className={styles.hint}>{t('dispute.opened_at', { at: formatDateTime(Date.parse(d.openedAt), lang) })}</p>
      {deadlines.some(([, at]) => at) && (
        <dl className={styles.deadlines}>
          {deadlines.filter(([, at]) => at).map(([key, at]) => (
            <div key={key}><dt>{t(key)}</dt><dd>{formatDeadline(Date.parse(at as string), now, lang)}</dd></div>
          ))}
        </dl>
      )}
      {outcome && (
        <div className={styles.request}>
          <h3>{t('dispute.outcome_title')}</h3>
          <p><strong>{t(`dispute.outcome.${outcome.kind}`, { amount: outcome.itemRefund ? formatMoney(BigInt(outcome.itemRefund), lang) : '' })}</strong></p>
          {outcome.reason && <p>{t('dispute.outcome_reason', { reason: outcome.reason })}</p>}
          {outcome.decidedAt && <p className={styles.hint}>{t('dispute.decided_at', { at: formatDateTime(Date.parse(outcome.decidedAt), lang) })}</p>}
        </div>
      )}
      <h3>{t('dispute.description_title')}</h3>
      <p className={styles.wrap}>{d.description}</p>
      <h3>{t('dispute.statements')}</h3>
      {d.statements.length === 0 ? <p className={styles.hint}>{t('dispute.no_statements')}</p> : (
        <ol className={styles.statements}>
          {d.statements.map((s, i) => (
            <li key={i}>
              <p><strong>{t(`dispute.party.${s.party === d.role ? 'you' : s.party}`)}</strong>, {formatDateTime(Date.parse(s.at), lang)}</p>
              <p className={styles.wrap}>{s.text ?? t('dispute.removed')}</p>
            </li>
          ))}
        </ol>
      )}
      <h3>{t('dispute.your_evidence')}</h3>
      {d.evidence.length === 0 ? <p className={styles.hint}>{t('dispute.no_evidence')}</p> : (
        <ul>
          {d.evidence.map((e, i) => (
            <li key={e.id}>
              {e.link
                ? <a href={e.link.url} target="_blank" rel="noopener noreferrer">{t('dispute.evidence_item', { n: toLocalDigits(String(i + 1), lang) })}</a>
                : <span>{t('dispute.evidence_removed', { n: toLocalDigits(String(i + 1), lang) })}</span>}
              {' · '}{formatDateTime(Date.parse(e.at), lang)}
            </li>
          ))}
        </ul>
      )}
      {live && <Statement d={d} t={t} lang={lang} />}
      {live && d.evidence.length < MAX_FILES && <AddEvidence d={d} t={t} lang={lang} />}
      {live && d.role === 'buyer' && d.status !== 'awaiting_return' && <Withdraw d={d} o={o} t={t} lang={lang} />}
      {!o && <p><Link to={`/orders/${encodeURIComponent(d.orderId)}`}>{t('dispute.to_order')}</Link></p>}
    </section>
  );
}

function useRefresh(d: DisputeView) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: disputeKey(d.id) });
    void queryClient.invalidateQueries({ queryKey: orderKey(d.orderId) });
  };
}

function Statement({ d, t, lang }: { d: DisputeView; t: T; lang: Lang }) {
  const api = useApi();
  const refresh = useRefresh(d);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.post(`/disputes/${encodeURIComponent(d.id)}/statements`, { text: text.trim() }),
    onSuccess: () => { setText(''); setMessage(null); refresh(); },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const responding = d.role === 'seller' && d.status === 'open';
  return (
    <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (text.trim()) add.mutate(); else setMessage(t('dispute.statement_empty')); }}>
      <label htmlFor={`statement-${d.id}`}>{t(responding ? 'dispute.response' : 'dispute.statement')}</label>
      {responding && <p className={styles.hint}>{t('dispute.response_hint')}</p>}
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <textarea id={`statement-${d.id}`} value={text} rows={4} maxLength={4000} onChange={(e) => setText(e.target.value)} />
      <div className={styles.buttons}>
        <button type="submit" className={styles.primary} disabled={add.isPending}>{t(responding ? 'dispute.send_response' : 'dispute.send_statement')}</button>
      </div>
    </form>
  );
}

function AddEvidence({ d, t, lang }: { d: DisputeView; t: T; lang: Lang }) {
  const api = useApi();
  const refresh = useRefresh(d);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.set('file', f, f.name);
      return api.post(`/disputes/${encodeURIComponent(d.id)}/evidence`, form);
    },
    onSuccess: () => {
      setMessage(null);
      if (input.current) input.current.value = '';
      refresh();
    },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const chosen = (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > MAX_BYTES) return setMessage(t('dispute.file_invalid', { name: f.name }));
    add.mutate(f);
  };
  return (
    <div className={styles.form}>
      <label htmlFor={`evidence-${d.id}`}>{t('dispute.add_evidence', { left: toLocalDigits(String(MAX_FILES - d.evidence.length), lang) })}</label>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <input ref={input} id={`evidence-${d.id}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={add.isPending} onChange={(e) => chosen(e.target.files)} />
      {add.isPending && <p role="status">{t('dispute.uploading_one')}</p>}
    </div>
  );
}

function Withdraw({ d, o, t, lang }: { d: DisputeView; o: OrderView | null; t: T; lang: Lang }) {
  const api = useApi();
  const refresh = useRefresh(d);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const withdraw = useMutation({
    mutationFn: () => api.post(`/disputes/${encodeURIComponent(d.id)}/withdraw`, {}),
    onSuccess: () => { setConfirming(false); refresh(); },
    onError: (e) => { setConfirming(false); setMessage(errorText(e, t, lang)); refresh(); },
  });
  const at = o?.escrow?.autoReleaseAt ? formatDateTime(Date.parse(o.escrow.autoReleaseAt), lang) : t('dispute.release_time_unknown');
  return (
    <div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <button type="button" className={styles.secondary} onClick={() => setConfirming(true)}>{t('dispute.withdraw')}</button>
      {confirming && (
        <ConfirmDialog id="withdraw-dispute" title={t('dispute.withdraw')} busy={withdraw.isPending}
          confirmLabel={t('dispute.withdraw_button')} cancelLabel={t('actions.back')}
          onConfirm={() => withdraw.mutate()} onCancel={() => setConfirming(false)}>
          <p>{t('confirm.withdraw_dispute', { at })}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
