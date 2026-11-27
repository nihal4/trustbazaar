import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { toLocalDigits } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { newClientId } from './model';
import styles from './chat.module.css';
import { MAX_TEXT } from './threadShared';
import { MAX_CAPTION, SendIcon, ClipIcon, chatError } from './threadParts';

/** The foot of the conversation: attach, a field that grows with what is typed (Enter sends, Shift+Enter breaks the line), and the round send button.
 *  FR-CHT-03: one photo with an optional caption; Unit 6 checks it and removes its metadata. A chosen photo waits in a panel above the bar. */
export function Dock({ threadId, t, lang, onSend, onSent }: { threadId: string; t: T; lang: Lang; onSend: (text: string) => void; onSent: () => void }) {
  const api = useApi();
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const length = [...text.normalize('NFC')].length;
  const tooLong = length > MAX_TEXT;
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const grow = () => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  };
  const submit = (ev?: FormEvent) => {
    ev?.preventDefault();
    const body = text.trim();
    if (!body || tooLong) return;
    onSend(body);
    setText('');
    requestAnimationFrame(grow);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const reset = () => {
    setFile(null);
    setCaption('');
    clientId.current = null;
    if (input.current) input.current.value = '';
  };
  const sendPhoto = (ev: FormEvent) => {
    ev.preventDefault();
    if (!file || busy) return;
    clientId.current ??= newClientId(); // the same id for a resend of this photo
    const form = new FormData();
    form.set('clientId', clientId.current);
    if (caption.trim()) form.set('caption', caption.trim());
    form.set('image', file);
    setBusy(true);
    setError(null);
    api
      .post(`/threads/${encodeURIComponent(threadId)}/images`, form)
      .then(
        () => {
          reset();
          onSent();
        },
        (e: unknown) => setError(chatError(e, t, lang)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div className={styles.dock}>
      {file && (
        <form className={styles.photoPanel} onSubmit={sendPhoto} noValidate>
          <p className={styles.fileName}>{file.name}</p>
          <label htmlFor="chat-caption">{t('thread.caption')}</label>
          <input id="chat-caption" type="text" maxLength={MAX_CAPTION} value={caption} onChange={(e) => setCaption(e.target.value)} />
          {error && <FormMessage kind="error">{error}</FormMessage>}
          <div className={styles.buttons}>
            <button type="submit" className={styles.primary} disabled={busy} aria-busy={busy}>
              {busy ? t('thread.sending') : t('thread.send_photo')}
            </button>
            <button type="button" className={styles.secondary} onClick={reset} disabled={busy}>
              {t('thread.cancel_photo')}
            </button>
          </div>
        </form>
      )}
      <div className={styles.bar}>
        <div className={styles.attach}>
          <label htmlFor="chat-photo" className={styles.iconBtn} title={t('thread.photo')}>
            <ClipIcon />
            <span className={styles.visuallyHidden}>{t('thread.photo')}</span>
          </label>
          <input
            id="chat-photo"
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setFile(e.target.files?.[0] ?? null);
              clientId.current = null;
            }}
          />
        </div>
        <form className={styles.composer} onSubmit={submit} noValidate>
          <label htmlFor="chat-text" className={styles.visuallyHidden}>
            {t('thread.label')}
          </label>
          <textarea
            id="chat-text"
            ref={field}
            className={styles.field}
            rows={1}
            value={text}
            aria-describedby="chat-hint chat-count"
            aria-invalid={tooLong || undefined}
            onChange={(e) => {
              setText(e.target.value);
              grow();
            }}
            onKeyDown={onKey}
          />
          <button type="submit" className={styles.sendBtn} disabled={!text.trim() || tooLong}>
            <SendIcon />
            <span className={styles.visuallyHidden}>{t('thread.send')}</span>
          </button>
        </form>
      </div>
      <p id="chat-hint" className={`${styles.hint} ${styles.dockNote}`}>
        {t('thread.hint')}
      </p>
      <p
        id="chat-count"
        className={tooLong ? `${styles.error} ${styles.dockNote}` : length > MAX_TEXT - 200 ? `${styles.hint} ${styles.dockNote}` : styles.visuallyHidden}
      >
        {tooLong
          ? t('thread.too_long', { max: toLocalDigits(String(MAX_TEXT), lang) })
          : t('thread.counter', { count: toLocalDigits(String(length), lang), max: toLocalDigits(String(MAX_TEXT), lang) })}
      </p>
    </div>
  );
}
