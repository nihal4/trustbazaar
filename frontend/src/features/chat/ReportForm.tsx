// Reporting a message or the whole conversation (FR-CHT-06): a category and a note, in a popup.
import { useState, type FormEvent } from 'react';
import { useApi } from '../../shared/api';
import { Popup, PopupActions } from '../../shared/Popup';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import styles from './chat.module.css';
import { MAX_TEXT, CATEGORIES, Category, Note } from './threadShared';

export function ReportForm({ threadId, seq, t, lang, onNote }: { threadId: string; seq: number | null; t: T; lang: Lang; onNote?: (n: Note | null) => void }) {
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Note | null>(null);
  const base = seq === null ? 'report-thread' : `report-${seq}`;
  // inside the popup an error stays in the popup; what is said after it closes goes to the caller or under the button
  const said = (n: Note | null) => (onNote ? onNote(n) : setMessage(n));
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (!category) {
      setMessage({ kind: 'error', text: t('report.choose') });
      return;
    }
    setBusy(true);
    api
      .post(`/threads/${encodeURIComponent(threadId)}/reports`, {
        category,
        ...(seq !== null ? { messageSeq: seq } : {}),
        ...(text.trim() ? { text: text.trim() } : {}),
      })
      .then(
        () => {
          setOpen(false);
          setMessage(null);
          said({ kind: 'success', text: t('report.sent') });
        },
        (e: unknown) => {
          if (problemName(e) === 'feature-off') {
            setOpen(false);
            setMessage(null);
            said({ kind: 'info', text: t('report.unavailable') });
          } else setMessage({ kind: 'error', text: errorText(e, t, lang) });
        },
      )
      .finally(() => setBusy(false));
  };
  return (
    <>
      {!open && !onNote && message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <button
        type="button"
        className={styles.linkButton}
        onClick={() => {
          setOpen(true);
          setMessage(null);
          said(null);
        }}
      >
        {t(seq === null ? 'report.thread' : 'report.message')}
      </button>
      {open && (
        <Popup
          id={base}
          title={t(seq === null ? 'report.title_thread' : 'report.title_message')}
          closeLabel={t('report.cancel')}
          busy={busy}
          onClose={() => setOpen(false)}
        >
          <form className={styles.report} onSubmit={submit} noValidate>
            <fieldset>
              <legend className={styles.visuallyHidden}>{t(seq === null ? 'report.title_thread' : 'report.title_message')}</legend>
              <p className={styles.hint}>{t('report.category')}</p>
              {CATEGORIES.map((c) => (
                <div key={c}>
                  <input id={`${base}-${c}`} type="radio" name={base} checked={category === c} onChange={() => setCategory(c)} />
                  <label htmlFor={`${base}-${c}`}>{t(`report.category.${c}`)}</label>
                </div>
              ))}
            </fieldset>
            <label className={styles.fieldLabel} htmlFor={`${base}-text`}>
              {t('report.text')}
            </label>
            <textarea id={`${base}-text`} rows={3} maxLength={MAX_TEXT} value={text} onChange={(e) => setText(e.target.value)} />
            {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
            <PopupActions>
              <button type="submit" disabled={busy} aria-busy={busy}>
                {t('report.send')}
              </button>
              <button type="button" onClick={() => setOpen(false)} disabled={busy}>
                {t('report.cancel')}
              </button>
            </PopupActions>
          </form>
        </Popup>
      )}
    </>
  );
}
