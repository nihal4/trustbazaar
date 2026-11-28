// A party's dispute chat as the operator sees it: the party's statements and what TrustBazaar sent them.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from '../staff.module.css';
import { staffError } from './common';
import { Button } from '../../shared/ui';
import { ChatView } from './disputeTypes';

/** What one message says: that it was removed, its words, or its caption with a link to the file. */
function MessageBody({ m, t }: { m: ChatView['messages'][number]; t: T }) {
  if (m.removed) return <p className={styles.hint}>{t('staff.dispute.removed')}</p>;
  if (m.kind === 'text') return <p className={styles.text}>{m.text}</p>;
  return (
    <p>
      {m.caption}
      {m.image && (
        <>
          {' '}
          <a href={m.image.url} target="_blank" rel="noopener noreferrer">
            {t('staff.case.open_file')}
          </a>
        </>
      )}
    </p>
  );
}

export function Chat({ path, t, lang }: { path: string; t: T; lang: Lang }) {
  const api = useApi();
  const [shown, setShown] = useState(false);
  const chat = useQuery({
    queryKey: ['staff', 'chat', path],
    queryFn: ({ signal }) => api.get(path, { signal }) as Promise<ChatView>,
    enabled: shown,
    staleTime: 0,
    retry: false,
  });
  return (
    <section className={styles.panel} aria-labelledby="dispute-chat">
      <h2 id="dispute-chat">{t('staff.dispute.chat')}</h2>
      {!shown && (
        <Button variant="secondary" type="button" onClick={() => setShown(true)}>
          {t('staff.dispute.show_chat')}
        </Button>
      )}
      {chat.isError && <FormMessage kind="error">{staffError(chat.error, t, lang)}</FormMessage>}
      {chat.data && (
        <ol className={styles.items}>
          {chat.data.messages.map((m) => (
            <li key={m.seq} className={styles.message}>
              <p>
                <strong>{t(`staff.party.${m.from}`)}</strong> · {formatDateTime(Date.parse(m.at), lang)}
                {m.flags.length ? ` · ${m.flags.join(', ')}` : ''}
              </p>
              <MessageBody m={m} t={t} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
