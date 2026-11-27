import { DateCells } from '../../shared/Moment';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { handoverKey, orderKey, type HandoverView, type OrderView, type Proposal } from './model';
import styles from './orders.module.css';
import { placeName, Where } from './handoverShared';

export function Proposals({ o, h, t, lang }: { o: OrderView; h: HandoverView; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const respond = useMutation({
    mutationFn: ({ p, verb }: { p: Proposal; verb: 'accept' | 'decline' | 'withdraw' }) =>
      api.post(`/orders/${encodeURIComponent(o.id)}/meetup-proposals/${encodeURIComponent(p.id)}/${verb}`, {}) as Promise<HandoverView>,
    onSuccess: (next) => {
      setMessage(null);
      queryClient.setQueryData(handoverKey(o.id), next);
      void queryClient.invalidateQueries({ queryKey: orderKey(o.id) });
    },
    onError: (e) => {
      setMessage(errorText(e, t, lang));
      void queryClient.invalidateQueries({ queryKey: handoverKey(o.id) });
    },
  });
  const current = h.proposals.find((p) => p.status === 'proposed');
  const past = h.proposals.filter((p) => p.status !== 'proposed' && p.status !== 'accepted');
  return (
    <div>
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {current && (
        <div className={styles.proposal}>
          <h3>{t(current.byMe ? 'handover.your_proposal' : 'handover.their_proposal')}</h3>
          <p>
            <Where point={current.point} place={current.place} t={t} lang={lang} />
          </p>
          <dl className={styles.statusGrid}>
            <div>
              <dt>{t('handover.when_label')}</dt>
              <dd>
                <DateCells at={Date.parse(current.meetAt)} t={t} lang={lang} label={false} />
              </dd>
            </div>
          </dl>
          {current.note && <p>{t('handover.note_shown', { note: current.note })}</p>}
          <div className={styles.buttons}>
            {current.byMe ? (
              <button type="button" className={styles.secondary} disabled={respond.isPending} onClick={() => respond.mutate({ p: current, verb: 'withdraw' })}>
                {t('handover.withdraw')}
              </button>
            ) : (
              <>
                <button type="button" className={styles.primary} disabled={respond.isPending} onClick={() => respond.mutate({ p: current, verb: 'accept' })}>
                  {t('handover.accept')}
                </button>
                <button type="button" className={styles.secondary} disabled={respond.isPending} onClick={() => respond.mutate({ p: current, verb: 'decline' })}>
                  {t('handover.decline')}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {past.length > 0 && (
        <details>
          <summary>{t('handover.history', { count: toLocalDigits(String(past.length), lang) })}</summary>
          <ul>
            {past.map((p) => (
              <li key={p.id}>
                {placeName(p.point, p.place, lang)}, {formatDateTime(Date.parse(p.meetAt), lang)}: {t(`handover.proposal.${p.status}`)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
