// One message in a conversation: text or photo, the time, whether it was delivered or read, and the flag when the screen held it.
import { dateParts } from '../../lib/time.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { hasWebAddress, knownFlags, type ChatMessage } from './model';
import styles from './chat.module.css';
import { ReportForm } from './ReportForm';

export function MessageItem({
  m,
  role,
  threadId,
  mark,
  t,
  lang,
}: {
  m: ChatMessage;
  role: 'buyer' | 'seller' | null;
  threadId: string;
  mark: 'read' | 'delivered' | null;
  t: T;
  lang: Lang;
}) {
  const flags = knownFlags(m.flags);
  return (
    <li className={`${styles.message} ${m.fromMe ? styles.mine : styles.theirs}`}>
      <span className={styles.sender}>{m.fromMe ? t('thread.you') : null}</span>
      {m.removed ? (
        <p className={styles.muted}>{t('thread.removed')}</p>
      ) : (
        <>
          {m.kind === 'image' &&
            (m.image ? (
              <img className={styles.image} src={m.image.url} alt={m.caption ?? t('thread.image_alt')} loading="lazy" />
            ) : (
              <p className={styles.muted}>{t('thread.image_loading')}</p>
            ))}
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
      <div className={styles.foot}>
        {!m.fromMe && !m.removed && <ReportForm threadId={threadId} seq={m.seq} t={t} lang={lang} />}
        <span className={styles.time}>
          {(() => {
            const p = dateParts(Date.parse(m.at), lang);
            return (
              <>
                <span className={styles.visuallyHidden}>{`${p.weekday}, ${p.day} ${p.month} ${p.year}, `}</span>
                {`${p.time} ${p.period}`}
              </>
            );
          })()}
          {mark && <> · {t(`thread.${mark}`)}</>}
        </span>
      </div>
    </li>
  );
}
