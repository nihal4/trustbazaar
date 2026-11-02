// One conversation (IF-UI-07; sections 5 and 7.6; /messages/:thread). Messages are plain text (SEC-INP-03); a web
// address stays text, with a warning (FR-CHT-09). Unit 6's warnings show under a flagged message for both parties.
// The reference ChatThread (lib/live.js) keeps the messages in order: a live chat.message is appended if it is the
// next number, a gap or a reconnection fetches the missing ones (IF-COM-02), and our own message, shown as
// "Sending…" with its client id, is confirmed when the server's copy arrives. Block and report are on the thread.
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatThread } from '../../lib/live.js';
import { toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi, type Api } from '../../shared/api';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { useT } from '../../shared/language/Language';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { useLive, useLiveEvent } from '../../shared/live';
import { useMe } from '../../shared/me';
import { isApiError, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import en from '../../messages/en/chat.json';
import bn from '../../messages/bn/chat.json';
import {
  fetchMessages, fetchThreads, hasWebAddress, knownFlags, newClientId, THREADS_KEY, toChatMessage,
  type ChatMessage, type LiveMessage, type ThreadSummary,
} from './model';
import styles from './chat.module.css';

const CATALOGUES = { en, bn };
/** DV-40 */
export const MAX_TEXT = 2000;
const MAX_CAPTION = 300;
const CATEGORIES = ['fraudulent', 'counterfeit', 'prohibited', 'misrepresented', 'abusive'] as const;
type Category = (typeof CATEGORIES)[number];

/** The thread's summary from the thread list (there is no GET /threads/{id}): the newest pages first. */
async function findThread(api: Api, id: string, signal?: AbortSignal): Promise<ThreadSummary | null> {
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const page = await fetchThreads(api, cursor, signal);
    const found = page.items.find((th) => th.id === id);
    if (found) return found;
    if (!page.nextCursor) return null;
    cursor = page.nextCursor;
  }
  return null;
}

/** A chat-specific message for the problems the chat answers, else the generic one. */
function chatError(e: unknown, t: T, lang: Lang): string {
  const name = problemName(e);
  if (name === 'blocked') return t('error.blocked');
  if (name === 'thread-closed') return t('error.thread_closed');
  return errorText(e, t, lang);
}

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const me = useMe();
  const { thread: id = '' } = useParams();
  if (me.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (me.isError) {
    return (
      <div className={styles.page}>
        <h1>{t('chat.title')}</h1>
        <p>{t('chat.signed_out')}</p>
        <p><Link to={`/signin?next=${encodeURIComponent(`/messages/${id}`)}`}>{t('shell.sign_in')}</Link></p>
      </div>
    );
  }
  return <Conversation key={id} id={id} t={t} lang={lang} />;
}

function Conversation({ id, t, lang }: { id: string; t: T; lang: Lang }) {
  const api = useApi();
  const live = useLive();
  const queryClient = useQueryClient();
  const summary = useQuery({
    queryKey: [...THREADS_KEY, 'one', id],
    queryFn: ({ signal }) => findThread(api, id, signal),
    staleTime: FRESHNESS.account,
    retry: false,
  });

  const thread = useRef(new ChatThread());
  const [, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [marks, setMarks] = useState({ delivered: 0, read: 0 });
  const [closed, setClosed] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [sendError, setSendError] = useState<string | null>(null);

  // ---------------------------------------------------------------- acknowledgements (FR-CHT-05)
  const acked = useRef({ delivered: 0, read: 0 });
  const ack = useCallback(() => {
    const last = thread.current.lastSeq;
    const read = document.visibilityState === 'hidden' ? acked.current.read : last;
    if (last <= acked.current.delivered && read <= acked.current.read) return;
    acked.current = { delivered: Math.max(last, acked.current.delivered), read: Math.max(read, acked.current.read) };
    const body = { threadId: id, ...acked.current };
    if (!live?.send('chat.ack', body)) {
      void api.post(`/threads/${encodeURIComponent(id)}/marks`, { delivered: body.delivered, read: body.read }).catch(() => undefined);
    }
    void queryClient.invalidateQueries({ queryKey: [...THREADS_KEY, 'list'] });
  }, [api, id, live, queryClient]);
  useEffect(() => {
    const onVisible = () => ack();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ack]);

  // ---------------------------------------------------------------- resync (IF-COM-02)
  const syncing = useRef(false);
  const again = useRef(false);
  const sync = useCallback(async () => {
    if (syncing.current) {
      again.current = true;
      return;
    }
    syncing.current = true;
    try {
      do {
        again.current = false;
        for (let more = true; more;) {
          const page = await fetchMessages(api, id, thread.current.lastSeq);
          thread.current.resync(page.items.map(toChatMessage) as never); // ChatThread's own typedef is narrower than the server's fields
          setMarks(page.otherMarks);
          setClosed(page.closed);
          more = page.more && page.items.length > 0;
        }
      } while (again.current);
      setLoaded(true);
      setLoadError(null);
      bump();
      ack();
    } catch (e) {
      setLoadError(e);
    } finally {
      syncing.current = false;
    }
  }, [ack, api, bump, id]);

  useEffect(() => {
    void sync();
    return live?.onConnect(() => void sync());
  }, [live, sync]);

  useLiveEvent('chat.message', (p) => {
    const m = p as unknown as LiveMessage;
    if (m.threadId !== id) return;
    if (m.kind === 'image') {
      void sync(); // the image's link comes with the messages, for this session (CP-31)
      return;
    }
    thread.current.receive(toChatMessage({ ...m, image: null, removed: false }) as never);
    if (thread.current.needsResync) void sync();
    bump();
    ack();
  });
  useLiveEvent('chat.marks', (p) => {
    if (p.threadId !== id) return;
    setMarks({ delivered: Number(p.delivered) || 0, read: Number(p.read) || 0 });
  });

  // ---------------------------------------------------------------- sending (FR-CHT-02)
  const send = useCallback((text: string, clientId: string) => {
    setSendError(null);
    thread.current.send(text, clientId);
    setFailed((f) => {
      const n = new Set(f);
      n.delete(clientId);
      return n;
    });
    bump();
    api.post(`/threads/${encodeURIComponent(id)}/messages`, { clientId, text }).then(
      () => {
        if (thread.current.pending.has(clientId)) void sync(); // the live copy was missed: fetch it
      },
      (e: unknown) => {
        setFailed((f) => new Set(f).add(clientId));
        setSendError(chatError(e, t, lang));
        if (problemName(e) === 'thread-closed') setClosed(true);
      },
    );
  }, [api, bump, id, lang, sync, t]);

  if (loadError && !loaded) {
    return (
      <div className={styles.page}>
        <p><Link to="/messages">{t('thread.back')}</Link></p>
        {isApiError(loadError, 404) ? <h1>{t('thread.not_found')}</h1> : <FormMessage kind="error">{errorText(loadError, t, lang)}</FormMessage>}
      </div>
    );
  }
  const s = summary.data ?? null;
  const name = s?.other?.displayName ?? t('chat.closed_account');
  const messages = thread.current.messages as ChatMessage[];
  const pending = [...thread.current.pending.values()];
  const lastMine = [...messages].reverse().find((m) => m.fromMe);

  return (
    <div className={styles.page}>
      <p><Link to="/messages">{t('thread.back')}</Link></p>
      <h1>{t('thread.with', { name })}{s?.other?.verified && <span className={styles.badge}>{t('chat.verified')}</span>}</h1>
      {s && (
        <p className={styles.about}>
          {s.listing.title
            ? <Link to={`/listings/${encodeURIComponent(s.listing.id)}`}>{t('thread.listing', { title: s.listing.title })}</Link>
            : t('chat.about', { title: t('chat.listing_gone') })}
          {' · '}{t(s.role === 'buyer' ? 'chat.buying' : 'chat.selling')}
        </p>
      )}
      {s?.other && <ThreadActions threadId={id} other={s.other} t={t} lang={lang} />}

      <h2 className={styles.visuallyHidden}>{t('thread.messages')}</h2>
      {!loaded ? <p role="status">{t('shell.loading')}</p> : (
        <ol className={styles.messages} role="log" aria-label={t('thread.messages')}>
          {messages.length === 0 && pending.length === 0 && <li className={styles.empty}>{t('thread.empty')}</li>}
          {messages.map((m) => (
            <MessageItem key={m.seq} m={m} role={s?.role ?? null} threadId={id} t={t} lang={lang}
              mark={m === lastMine ? (marks.read >= m.seq ? 'read' : marks.delivered >= m.seq ? 'delivered' : null) : null} />
          ))}
          {pending.map((p) => (
            <li key={p.clientMsgId} className={`${styles.message} ${styles.mine}`}>
              <span className={styles.sender}>{t('thread.you')}</span>
              <p className={styles.text}>{p.text}</p>
              {failed.has(p.clientMsgId)
                ? <p className={styles.status}>{t('thread.failed')}{' '}
                    {!closed && <button type="button" className={styles.linkButton} onClick={() => send(p.text, p.clientMsgId)}>{t('thread.retry')}</button>}
                  </p>
                : <p className={styles.status} role="status">{t('thread.sending')}</p>}
            </li>
          ))}
        </ol>
      )}
      {sendError && <FormMessage kind="error">{sendError}</FormMessage>}
      {closed ? <p className={styles.notice}>{t('thread.closed')}</p> : loaded && (
        <>
          <Composer t={t} lang={lang} onSend={(text) => send(text, newClientId())} />
          <PhotoForm threadId={id} t={t} lang={lang} onSent={() => void sync()} />
        </>
      )}
    </div>
  );
}

function MessageItem({ m, role, threadId, mark, t, lang }: {
  m: ChatMessage; role: 'buyer' | 'seller' | null; threadId: string; mark: 'read' | 'delivered' | null; t: T; lang: Lang;
}) {
  const flags = knownFlags(m.flags);
  return (
    <li className={`${styles.message} ${m.fromMe ? styles.mine : styles.theirs}`}>
      <span className={styles.sender}>{m.fromMe ? t('thread.you') : null}</span>
      {m.removed ? <p className={styles.muted}>{t('thread.removed')}</p> : (
        <>
          {m.kind === 'image' && (m.image
            ? <img className={styles.image} src={m.image.url} alt={m.caption ?? t('thread.image_alt')} loading="lazy" />
            : <p className={styles.muted}>{t('thread.image_loading')}</p>)}
          {m.kind === 'image' && m.caption && <p className={styles.text}>{m.caption}</p>}
          {m.kind === 'text' && <p className={styles.text}>{m.text}</p>}
          {hasWebAddress(m.text ?? m.caption) && <p className={styles.linkWarning}>{t('thread.link_warning')}</p>}
        </>
      )}
      {flags.map((f) => (
        <p key={f} className={styles.flag} role="note">
          {t(`flag.${f}`)}
          {f === 'credentials' && role === 'seller' && <> {t('flag.credentials_seller')}</>}
        </p>
      ))}
      <span className={styles.time}>{formatDateTime(Date.parse(m.at), lang)}{mark && <> · {t(`thread.${mark}`)}</>}</span>
      {!m.fromMe && !m.removed && <ReportForm threadId={threadId} seq={m.seq} t={t} lang={lang} />}
    </li>
  );
}

function Composer({ t, lang, onSend }: { t: T; lang: Lang; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const length = [...text.normalize('NFC')].length;
  const tooLong = length > MAX_TEXT;
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const body = text.trim();
    if (!body || tooLong) return;
    onSend(body);
    setText('');
  };
  return (
    <form className={styles.composer} onSubmit={submit} noValidate>
      <label htmlFor="chat-text">{t('thread.label')}</label>
      <p id="chat-hint" className={styles.hint}>{t('thread.hint')}</p>
      <textarea id="chat-text" rows={3} value={text} aria-describedby="chat-hint chat-count" aria-invalid={tooLong || undefined}
        onChange={(e) => setText(e.target.value)} />
      <p id="chat-count" className={tooLong ? styles.error : styles.hint}>
        {tooLong ? t('thread.too_long', { max: toLocalDigits(String(MAX_TEXT), lang) })
          : t('thread.counter', { count: toLocalDigits(String(length), lang), max: toLocalDigits(String(MAX_TEXT), lang) })}
      </p>
      <button type="submit" disabled={!text.trim() || tooLong}>{t('thread.send')}</button>
    </form>
  );
}

/** FR-CHT-03: one photo with an optional caption; Unit 6 checks it and removes its metadata. */
function PhotoForm({ threadId, t, lang, onSent }: { threadId: string; t: T; lang: Lang; onSent: () => void }) {
  const api = useApi();
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const reset = () => {
    setFile(null);
    setCaption('');
    clientId.current = null;
    if (input.current) input.current.value = '';
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!file || busy) return;
    clientId.current ??= newClientId(); // the same id for a resend of this photo
    const form = new FormData();
    form.set('clientId', clientId.current);
    if (caption.trim()) form.set('caption', caption.trim());
    form.set('image', file);
    setBusy(true);
    setError(null);
    api.post(`/threads/${encodeURIComponent(threadId)}/images`, form).then(
      () => {
        reset();
        onSent();
      },
      (e: unknown) => setError(chatError(e, t, lang)),
    ).finally(() => setBusy(false));
  };
  return (
    <form className={styles.photo} onSubmit={submit} noValidate>
      <label htmlFor="chat-photo">{t('thread.photo')}</label>
      <input id="chat-photo" ref={input} type="file" accept="image/jpeg,image/png,image/webp"
        onChange={(e: ChangeEvent<HTMLInputElement>) => { setFile(e.target.files?.[0] ?? null); clientId.current = null; }} />
      {file && (
        <>
          <label htmlFor="chat-caption">{t('thread.caption')}</label>
          <input id="chat-caption" type="text" maxLength={MAX_CAPTION} value={caption} onChange={(e) => setCaption(e.target.value)} />
          {error && <FormMessage kind="error">{error}</FormMessage>}
          <div className={styles.row}>
            <button type="submit" disabled={busy} aria-busy={busy}>{busy ? t('thread.sending') : t('thread.send_photo')}</button>
            <button type="button" className={styles.secondary} onClick={reset} disabled={busy}>{t('thread.cancel_photo')}</button>
          </div>
        </>
      )}
    </form>
  );
}

/** FR-CHT-08 and FR-CHT-06: block with its consequence stated first (section 8.4), and report the thread. */
function ThreadActions({ threadId, other, t, lang }: { threadId: string; other: { id: string; displayName: string }; t: T; lang: Lang }) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const name = other.displayName;
  const path = `/blocks/${encodeURIComponent(other.id)}`;
  const block = () => {
    setBusy(true);
    api.post(path, {}).then(
      () => {
        setBlocked(true);
        setMessage({ kind: 'success', text: t('thread.blocked_done', { name }) });
      },
      (e: unknown) => setMessage({ kind: 'error', text: errorText(e, t, lang) }),
    ).finally(() => {
      setBusy(false);
      setConfirming(false);
    });
  };
  const unblock = () => {
    setBusy(true);
    api.del(path).then(
      () => {
        setBlocked(false);
        setMessage({ kind: 'success', text: t('thread.unblocked_done', { name }) });
      },
      (e: unknown) => setMessage({ kind: 'error', text: errorText(e, t, lang) }),
    ).finally(() => setBusy(false));
  };
  return (
    <section aria-label={t('thread.actions')} className={styles.actions}>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <div className={styles.row}>
        {blocked
          ? <button type="button" className={styles.secondary} onClick={unblock} disabled={busy}>{t('thread.unblock', { name })}</button>
          : <button type="button" className={styles.secondary} onClick={() => setConfirming(true)} disabled={busy}>{t('thread.block', { name })}</button>}
        <ReportForm threadId={threadId} seq={null} t={t} lang={lang} />
      </div>
      {confirming && (
        <ConfirmDialog id="block-confirm" title={t('confirm.block.title', { name })} confirmLabel={t('confirm.block.confirm', { name })}
          cancelLabel={t('confirm.cancel')} busy={busy} onConfirm={block} onCancel={() => setConfirming(false)}>
          <p>{t('confirm.block.body', { name })}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}

/** A report of the thread (seq null) or of one of the other party's messages, to the report queue (Unit 7). */
function ReportForm({ threadId, seq, t, lang }: { threadId: string; seq: number | null; t: T; lang: Lang }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(null);
  const base = seq === null ? 'report-thread' : `report-${seq}`;
  if (!open) {
    return (
      <>
        {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
        <button type="button" className={styles.linkButton} onClick={() => { setOpen(true); setMessage(null); }}>
          {t(seq === null ? 'report.thread' : 'report.message')}
        </button>
      </>
    );
  }
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!category) {
      setMessage({ kind: 'error', text: t('report.choose') });
      return;
    }
    setBusy(true);
    api.post(`/threads/${encodeURIComponent(threadId)}/reports`, {
      category, ...(seq !== null ? { messageSeq: seq } : {}), ...(text.trim() ? { text: text.trim() } : {}),
    }).then(
      () => {
        setOpen(false);
        setMessage({ kind: 'success', text: t('report.sent') });
      },
      (e: unknown) => {
        if (problemName(e) === 'feature-off') {
          setOpen(false);
          setMessage({ kind: 'info', text: t('report.unavailable') });
        } else setMessage({ kind: 'error', text: errorText(e, t, lang) });
      },
    ).finally(() => setBusy(false));
  };
  return (
    <form className={styles.report} onSubmit={submit} noValidate>
      <fieldset>
        <legend>{t(seq === null ? 'report.title_thread' : 'report.title_message')}</legend>
        <p className={styles.hint}>{t('report.category')}</p>
        {CATEGORIES.map((c) => (
          <div key={c}>
            <input id={`${base}-${c}`} type="radio" name={base} checked={category === c} onChange={() => setCategory(c)} />
            <label htmlFor={`${base}-${c}`}>{t(`report.category.${c}`)}</label>
          </div>
        ))}
      </fieldset>
      <label htmlFor={`${base}-text`}>{t('report.text')}</label>
      <textarea id={`${base}-text`} rows={2} maxLength={MAX_TEXT} value={text} onChange={(e) => setText(e.target.value)} />
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <div className={styles.row}>
        <button type="submit" disabled={busy} aria-busy={busy}>{t('report.send')}</button>
        <button type="button" className={styles.secondary} onClick={() => setOpen(false)} disabled={busy}>{t('report.cancel')}</button>
      </div>
    </form>
  );
}
