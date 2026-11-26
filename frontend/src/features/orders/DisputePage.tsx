// /disputes/:id (docs/design/08_frontend.pdf section 7.7; U8-09; U10-23): the dispute chat, written like a messenger. The buyer and the seller never write to
// each other about a dispute; TrustBazaar stands between them. Each party sees here its own messages and files and what TrustBazaar sent it (a complaint was
// filed, a request for information, the decision), and writes to TrustBazaar from the box at the bottom: Enter sends, the paperclip adds a photo or video.
// The buyer can withdraw the dispute from here too. Opening the chat marks TrustBazaar's messages as seen; notices about a dispute open it directly.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import { DateCells } from '../../shared/Moment';
import { dateParts } from '../../lib/time.js';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { formatMoney, toLocalDigits } from '../../lib/money.js';
import { orderKey, type OrderView } from './model';
import { ReturnStep } from './ReturnStep';
import { disputesKey, MAX_VIDEOS, usableEvidence, useDispute, Withdraw } from './Disputes';
import en from '../../messages/en/orders.json';
import bn from '../../messages/bn/orders.json';
import styles from './orders.module.css';

const CATALOGUES = { en, bn };
const VIDEO = /^video\//;

interface ChatItem {
  from: 'you' | 'trustbazaar'; text?: string | null; file?: { id: string; mime: string; link: { url: string } | null }; template?: string; params?: Record<string, unknown>;
  at: string; unseen?: boolean;
}
interface Chat { role: 'buyer' | 'seller'; status: string; items: ChatItem[] }

export const chatKey = (id: string) => ['disputes', id, 'chat'] as const;

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const queryClient = useQueryClient();
  const dispute = useDispute(id);
  const chat = useQuery({
    queryKey: chatKey(id),
    queryFn: ({ signal }) => api.get(`/disputes/${encodeURIComponent(id)}/chat`, { signal }) as Promise<Chat>,
    staleTime: FRESHNESS.money,
    refetchInterval: (q) => (['decided', 'withdrawn'].includes(q.state.data?.status ?? '') ? false : 8_000),
    retry: false,
  });
  const order = useQuery({
    queryKey: orderKey(dispute.data?.orderId ?? ''),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(dispute.data!.orderId)}`, { signal }) as Promise<OrderView>,
    enabled: !!dispute.data, staleTime: FRESHNESS.money, retry: false,
  });
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const orderId = dispute.data?.orderId;
  const unseen = (chat.data?.items ?? []).some((m) => m.unseen);
  const count = chat.data?.items.length ?? 0;

  // reading the chat: TrustBazaar's messages are seen, and the order page's count of new messages goes away
  useEffect(() => {
    if (!unseen) return;
    void api.post(`/disputes/${encodeURIComponent(id)}/chat/seen`, {}).then(() => {
      if (orderId) void queryClient.invalidateQueries({ queryKey: disputesKey(orderId) });
    }).catch(() => undefined);
  }, [unseen, id, orderId, api, queryClient]);
  // the thread scrolls inside its own frame and follows the newest message; the box below it stays where it is
  useEffect(() => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; }, [count, chat.isPending, dispute.isPending]);

  const refresh = () => { void chat.refetch(); void dispute.refetch(); };
  const send = useMutation({
    mutationFn: (value: string) => api.post(`/disputes/${encodeURIComponent(id)}/statements`, { text: value }),
    onSuccess: () => { setText(''); setMessage(null); refresh(); box.current?.focus(); },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  const attach = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.set('file', f, f.name);
      return api.post(`/disputes/${encodeURIComponent(id)}/evidence`, form);
    },
    onSuccess: () => { setMessage(null); if (file.current) file.current.value = ''; refresh(); },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });

  if (chat.isPending || dispute.isPending) return <p role="status">{t('shell.loading')}</p>;
  const failure = !chat.data || !dispute.data ? (chat.error ?? dispute.error) : null;
  if (failure) {
    if (isApiError(failure, 401)) return <p><Link to={signInPath(`/disputes/${id}`)}>{t('order.sign_in')}</Link></p>;
    return isApiError(failure, 404) ? <h1>{t('dispute.not_found')}</h1> : <FormMessage kind="error">{errorText(failure, t, lang)}</FormMessage>;
  }
  const d = dispute.data!;
  const c = chat.data!;
  const live = ['open', 'awaiting_seller', 'under_review', 'awaiting_return'].includes(d.status);
  const responding = c.role === 'seller' && d.status === 'open';
  const stateWord = responding ? t('dispute.state.open.seller') : t(`dispute.state.${d.status}`);

  // TrustBazaar's messages are catalogue texts filled with their parameters; a decision has one text for each outcome and role
  const said = (m: ChatItem): string => {
    const p = (m.params ?? {}) as Record<string, string | number>;
    const key = m.template === 'dispute.decided' ? `dispute.msg.decided.${String(p.outcome ?? 'none')}.${c.role}` : `dispute.msg.${m.template}.${c.role}`;
    return t(key, { ...p, amount: p.itemRefund ? formatMoney(BigInt(String(p.itemRefund)), lang) : '' });
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || send.isPending) return;
    send.mutate(text.trim());
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends with a keyboard; a phone's soft keyboard has no Shift, so there Enter adds a line and Send sends
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !touch) { e.preventDefault(); submit(); }
  };
  const picked = (list: FileList | null) => {
    const f = list?.[0];
    if (file.current) file.current.value = ''; // the same file can be chosen again
    if (!f) return;
    if (!usableEvidence(f)) return setMessage(t('dispute.file_invalid', { name: f.name }));
    if (VIDEO.test(f.type) && c.items.filter((m) => m.file && VIDEO.test(m.file.mime)).length >= MAX_VIDEOS) return setMessage(t('dispute.too_many_videos', { max: toLocalDigits(String(MAX_VIDEOS), lang) }));
    attach.mutate(f);
  };
  // the thread by day: a separator with the day as cells, then that day's messages, each with its time as one small cell
  const dayKey = (iso: string) => { const p = dateParts(Date.parse(iso), lang); return `${p.year}-${p.month}-${p.day}`; };
  const rows: ({ kind: 'day'; at: string } | { kind: 'msg'; m: ChatItem })[] = [];
  c.items.forEach((m, i) => {
    if (i === 0 || dayKey(c.items[i - 1].at) !== dayKey(m.at)) rows.push({ kind: 'day', at: m.at });
    rows.push({ kind: 'msg', m });
  });
  return (
    <div className={styles.dcPage}>
      <aside className={styles.dcSide} aria-label={t('dispute.slot_title')}>
        <Link to={`/orders/${encodeURIComponent(d.orderId)}`} className={styles.dcBack}>{t('dispute.to_order')}</Link>
        <h1>{t('dispute.chat_title')}</h1>
        <dl className={styles.dcFacts}>
          <div><dt>{t('dispute.type')}</dt><dd>{t(`dispute.type.${d.type}`)}</dd></div>
          <div><dt>{t('handover.status_label')}</dt><dd>{stateWord}</dd></div>
          <div><dt>{t('dispute.opened_label')}</dt><dd><DateCells at={Date.parse(d.openedAt)} t={t} lang={lang} label={false} /></dd></div>
        </dl>
        {live && d.role === 'buyer' && d.status !== 'awaiting_return' && <Withdraw d={d} o={order.data ?? null} t={t} lang={lang} />}
        {live && d.role === 'seller' && d.status === 'awaiting_return' && <ReturnStep d={d} t={t} lang={lang} />}
        <p className={styles.hint}>{t('dispute.chat_intro')}</p>
      </aside>
      <section className={styles.dcMain} aria-label={t('dispute.chat_title')}>
        <header className={styles.dcHead}>
          <strong>{t('dispute.party.trustbazaar')}</strong>
          <span>{stateWord}</span>
        </header>
        <div className={styles.dcThread} ref={thread} tabIndex={0} role="log" aria-live="polite" aria-label={t('dispute.chat_title')}>
          {rows.length === 0 && <p className={styles.dcEmpty}>{t('dispute.chat_empty')}</p>}
          {rows.map((r, i) => r.kind === 'day'
            ? <div key={`d${i}`} className={styles.dcDay}><DateCells at={Date.parse(r.at)} t={t} lang={lang} label={false} compact part="day" /></div>
            : (
              <div key={`m${i}`} className={r.m.from === 'you' ? `${styles.dcRow} ${styles.dcMine}` : styles.dcRow}>
                <div className={styles.dcBubble}>
                  <span className={styles.srOnly}>{t(r.m.from === 'you' ? 'dispute.party.you' : 'dispute.party.trustbazaar')}: </span>
                  {r.m.file
                    ? (r.m.file.link
                      ? <a href={r.m.file.link.url} target="_blank" rel="noopener noreferrer">{t(VIDEO.test(r.m.file.mime) ? 'dispute.sent_video' : 'dispute.sent_photo')}</a>
                      : <p>{t('dispute.removed')}</p>)
                    : <p>{r.m.from === 'you' ? (r.m.text ?? t('dispute.removed')) : said(r.m)}</p>}
                  <span className={styles.dcTime}><DateCells at={Date.parse(r.m.at)} t={t} lang={lang} label={false} compact inline part="time" /></span>
                </div>
              </div>
            ))}
        </div>
        {live ? (
          <form className={styles.dcComposer} onSubmit={submit} noValidate>
            {message && <FormMessage kind="error">{message}</FormMessage>}
            {responding && <p className={styles.hint}>{t('dispute.response_hint')}</p>}
            <div className={styles.dcBar}>
              <input ref={file} id="chat-file" type="file" aria-label={t('dispute.attach')} className={styles.fileHidden} accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => picked(e.target.files)} disabled={attach.isPending} />
              <label htmlFor="chat-file" className={styles.dcAttach} title={t('dispute.attach')}>
                <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M14.5 9.5 9 15a3 3 0 0 1-4.2-4.2l6-6a2 2 0 0 1 2.8 2.8l-6 6a1 1 0 0 1-1.4-1.4L11 7.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </label>
              <textarea ref={box} className={styles.dcInput} aria-label={t('dispute.type_message')} placeholder={t('dispute.type_message')} value={text} rows={1} maxLength={4000} onKeyDown={onKey} onChange={(e) => setText(e.target.value)} />
              <button type="submit" className={styles.dcSend} disabled={send.isPending || !text.trim()}>{t('dispute.send')}</button>
            </div>
            {attach.isPending && <p role="status" className={styles.hint}>{t('dispute.uploading_one')}</p>}
          </form>
        ) : <p className={styles.dcClosed}>{stateWord}</p>}
      </section>
    </div>
  );
}
