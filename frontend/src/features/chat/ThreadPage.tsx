// One conversation (IF-UI-07; sections 5 and 7.6; /messages/:thread). Messages are plain text (SEC-INP-03); a web
// address stays text, with a warning (FR-CHT-09). Unit 6's warnings show under a flagged message for both parties.
// The reference ChatThread (lib/live.js) keeps the messages in order: a live chat.message is appended if it is the
// next number, a gap or a reconnection fetches the missing ones (IF-COM-02), and our own message, shown as
// "Sending…" with its client id, is confirmed when the server's copy arrives. Block and report are on the thread.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatThread } from '../../lib/live.js';

import { dateParts } from '../../lib/time.js';
import { useApi, type Api } from '../../shared/api';

import { THREADS_UNREAD_KEY } from '../../shared/notifications';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import { Tick } from '../../shared/icons';
import { useT } from '../../shared/language/Language';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { useLive, useLiveEvent } from '../../shared/live';
import { useMe } from '../../shared/me';
import { isApiError, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import en from '../../messages/en/chat.json';
import bn from '../../messages/bn/chat.json';
import { fetchMessages, fetchThreads, newClientId, THREADS_KEY, toChatMessage, type ChatMessage, type LiveMessage, type ThreadSummary } from './model';
import styles from './chat.module.css';

import { ThreadActions } from './ThreadActions';
import { MessageItem } from './MessageItem';
import { Dock } from './Dock';
import { chatError, stroke } from './threadParts';

const CATALOGUES = { en, bn };
const BackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M15 5 L8 12 L15 19" {...stroke} />
  </svg>
);
const initialOf = (name: string) => (Array.from(name.trim())[0] ?? '?').toUpperCase();

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
        <p>
          <Link to={`/signin?next=${encodeURIComponent(`/messages/${id}`)}`}>{t('shell.sign_in')}</Link>
        </p>
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
    // the count in the header drops once the server has the mark
    window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: THREADS_UNREAD_KEY }), 1200);
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
  const send = useCallback(
    (text: string, clientId: string) => {
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
    },
    [api, bump, id, lang, sync, t],
  );

  // the newest message is in view: the log is scrolled to its end when a message comes or is sent
  const log = useRef<HTMLDivElement>(null);
  const shown = thread.current.messages.length + thread.current.pending.size;
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [loaded, shown]);

  if (loadError && !loaded) {
    return (
      <div className={styles.page}>
        <p>
          <Link to="/messages">{t('thread.back')}</Link>
        </p>
        {isApiError(loadError, 404) ? <h1>{t('thread.not_found')}</h1> : <FormMessage kind="error">{errorText(loadError, t, lang)}</FormMessage>}
      </div>
    );
  }
  const s = summary.data ?? null;
  const name = s?.other?.displayName ?? t('chat.closed_account');
  const messages = thread.current.messages as ChatMessage[];
  const pending = [...thread.current.pending.values()];
  const lastMine = [...messages].reverse().find((m) => m.fromMe);

  const sameDay = (a: string, b: string) => {
    const x = dateParts(Date.parse(a), lang);
    const y = dateParts(Date.parse(b), lang);
    return x.day === y.day && x.month === y.month && x.year === y.year;
  };
  return (
    <div className={styles.page}>
      <div className={styles.chat}>
        <header className={styles.chatHead}>
          <Link to="/messages" className={styles.backBtn}>
            <BackIcon />
            <span className={styles.visuallyHidden}>{t('thread.back')}</span>
          </Link>
          <span className={styles.headAvatar} aria-hidden="true">
            {initialOf(name)}
          </span>
          <div className={styles.headText}>
            <h1 aria-label={t('thread.with', { name })}>
              <span className={styles.headName}>{name}</span>
              {s?.other?.verified && (
                <span className={styles.tick} title={t('chat.verified')}>
                  <Tick />
                  <span className={styles.visuallyHidden}>{t('chat.verified')}</span>
                </span>
              )}
            </h1>
            {s && (
              <p className={styles.about}>
                {s.listing.title ? (
                  <Link className={styles.product} to={`/listings/${encodeURIComponent(s.listing.id)}`}>
                    {t('thread.listing', { title: s.listing.title })}
                  </Link>
                ) : (
                  <span className={styles.muted}>{t('chat.about', { title: t('chat.listing_gone') })}</span>
                )}
                <span className={styles.role}>{t(s.role === 'buyer' ? 'chat.buying' : 'chat.selling')}</span>
              </p>
            )}
          </div>
        </header>
        {s?.other && <ThreadActions threadId={id} other={s.other} t={t} lang={lang} />}

        <h2 className={styles.visuallyHidden}>{t('thread.messages')}</h2>
        {!loaded ? (
          <p role="status" className={styles.notice}>
            {t('shell.loading')}
          </p>
        ) : (
          <div ref={log} className={styles.messages} role="log" tabIndex={0} aria-label={t('thread.messages')}>
            <ol className={styles.messageList}>
              {messages.length === 0 && pending.length === 0 && <li className={styles.empty}>{t('thread.empty')}</li>}
              {messages.map((m, i) => {
                const p = dateParts(Date.parse(m.at), lang);
                return (
                  <Fragment key={m.seq}>
                    {(i === 0 || !sameDay(messages[i - 1].at, m.at)) && (
                      <li aria-hidden="true" className={styles.day}>
                        <span>{`${p.weekday}, ${p.day} ${p.month} ${p.year}`}</span>
                      </li>
                    )}
                    <MessageItem
                      m={m}
                      role={s?.role ?? null}
                      threadId={id}
                      t={t}
                      lang={lang}
                      mark={m === lastMine ? (marks.read >= m.seq ? 'read' : marks.delivered >= m.seq ? 'delivered' : null) : null}
                    />
                  </Fragment>
                );
              })}
              {pending.map((p) => (
                <li key={p.clientMsgId} className={`${styles.message} ${styles.mine}`}>
                  <span className={styles.sender}>{t('thread.you')}</span>
                  <p className={styles.text}>{p.text}</p>
                  {failed.has(p.clientMsgId) ? (
                    <p className={styles.status}>
                      {t('thread.failed')}{' '}
                      {!closed && (
                        <button type="button" className={styles.retry} onClick={() => send(p.text, p.clientMsgId)}>
                          {t('thread.retry')}
                        </button>
                      )}
                    </p>
                  ) : (
                    <p className={styles.status} role="status">
                      {t('thread.sending')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
        {sendError && (
          <div className={styles.actionNote}>
            <FormMessage kind="error">{sendError}</FormMessage>
          </div>
        )}
        {closed ? (
          <p className={styles.notice}>{t('thread.closed')}</p>
        ) : (
          loaded && <Dock threadId={id} t={t} lang={lang} onSend={(text) => send(text, newClientId())} onSent={() => void sync()} />
        )}
      </div>
    </div>
  );
}
