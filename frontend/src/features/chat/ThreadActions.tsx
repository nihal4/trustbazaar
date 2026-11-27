// What a member can do about a conversation: block or unblock the other party (FR-CHT-08, with its consequence stated first) and report.
import { useState } from 'react';
import { useApi } from '../../shared/api';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from './chat.module.css';
import { ReportForm } from './ReportForm';
import { Note } from './threadShared';

/** FR-CHT-08 and FR-CHT-06: block with its consequence stated first (section 8.4), and report the thread. */
export function ThreadActions({ threadId, other, t, lang }: { threadId: string; other: { id: string; displayName: string }; t: T; lang: Lang }) {
  const api = useApi();
  const [confirming, setConfirming] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Note | null>(null);
  const name = other.displayName;
  const path = `/blocks/${encodeURIComponent(other.id)}`;
  const block = () => {
    setBusy(true);
    api
      .post(path, {})
      .then(
        () => {
          setBlocked(true);
          setMessage({ kind: 'success', text: t('thread.blocked_done', { name }) });
        },
        (e: unknown) => setMessage({ kind: 'error', text: errorText(e, t, lang) }),
      )
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  };
  const unblock = () => {
    setBusy(true);
    api
      .del(path)
      .then(
        () => {
          setBlocked(false);
          setMessage({ kind: 'success', text: t('thread.unblocked_done', { name }) });
        },
        (e: unknown) => setMessage({ kind: 'error', text: errorText(e, t, lang) }),
      )
      .finally(() => setBusy(false));
  };
  return (
    <section aria-label={t('thread.actions')} className={styles.actionsWrap}>
      <div className={styles.actions}>
        {blocked ? (
          <button type="button" className={styles.secondary} onClick={unblock} disabled={busy}>
            {t('thread.unblock', { name })}
          </button>
        ) : (
          <button type="button" className={styles.secondary} onClick={() => setConfirming(true)} disabled={busy}>
            {t('thread.block', { name })}
          </button>
        )}
        <ReportForm threadId={threadId} seq={null} t={t} lang={lang} onNote={setMessage} />
      </div>
      {message && (
        <div className={styles.actionNote}>
          <FormMessage kind={message.kind}>{message.text}</FormMessage>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          id="block-confirm"
          title={t('confirm.block.title', { name })}
          confirmLabel={t('confirm.block.confirm', { name })}
          cancelLabel={t('confirm.cancel')}
          busy={busy}
          onConfirm={block}
          onCancel={() => setConfirming(false)}
        >
          <p>{t('confirm.block.body', { name })}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
