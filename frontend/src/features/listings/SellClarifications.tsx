import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { type EditableListing } from './sell';
import styles from './sell.module.css';
import { Button } from '../../shared/ui';
import { listingKey } from './sellShared';

export function Clarifications({ l, t, lang }: { l: EditableListing; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.post(`/listings/${encodeURIComponent(l.id)}/clarifications`, { body: body.trim() }),
    onSuccess: () => {
      setBody('');
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: listingKey(l.id) });
    },
    onError: (e) => setMessage(errorText(e, t, lang)),
  });
  return (
    <section aria-labelledby="clarify-title" className={styles.panel}>
      <h2 id="clarify-title">{t('sell.clarifications')}</h2>
      <p className={styles.hint}>{t('sell.clarifications_hint')}</p>
      {l.clarifications.length > 0 && (
        <ul>
          {l.clarifications.map((c) => (
            <li key={c.id}>
              <span className={styles.hint}>{formatDateTime(Date.parse(c.at), lang)}:</span> {c.body}
            </li>
          ))}
        </ul>
      )}
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <form
        noValidate
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
          else setMessage(t('sell.clarification_empty'));
        }}
      >
        <label htmlFor="clarification">{t('sell.add_clarification')}</label>
        <textarea id="clarification" value={body} rows={3} maxLength={1000} onChange={(e) => setBody(e.target.value)} />
        <div className={styles.buttons}>
          <Button variant="primary" type="submit" disabled={add.isPending}>
            {t('sell.send_clarification')}
          </Button>
        </div>
      </form>
    </section>
  );
}
