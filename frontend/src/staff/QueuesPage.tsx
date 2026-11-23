// The eight queues, /staff/queues/:queue (FR-OPS-01; section 7.9; Unit 7 section 2.3; U8-10): each oldest first, the
// overdue on top, each item with its age. A dispute, a report or a KYC submission is claimed before it is acted on;
// the claim runs the server's conflict check (FR-OPS-06), and a refusal is shown as its message. The case files and
// item opens its case: a claimed case only for the operator who claimed it. Daylight design (docs/design/10_visual.md,
// section 7.10, AC-STF-2): a table of case, what it is, amount, waiting time and who has it; ages of a day or more
// in danger red, with the time in words.
import { useState } from 'react';
import { Link, Navigate, useOutletContext, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, toLocalDigits } from '../lib/money.js';
import { formatDateTime, formatDeadline } from '../lib/time.js';
import { useApi } from '../shared/api';
import { useServerNow } from '../shared/clock';
import { errorText } from '../shared/errors';
import { FormMessage } from '../shared/form';
import type { T } from '../shared/language/catalogue';
import type { Lang } from '../shared/language/lang';
import { isApiError, problemName } from '../shared/problems';
import { ageParts, casePath, claimPath, queueKey, QUEUES, type QueueItem, type QueueName, type StaffMe } from './model';
import { useStaffT } from './text';
import styles from './staff.module.css';

const CLAIM_PROBLEMS = new Set(['conflict-of-interest', 'already-claimed']);

export function Component() {
  const { queue } = useParams();
  const { t, lang } = useStaffT();
  const me = useOutletContext<StaffMe>();
  if (!queue) return <Navigate to="/staff/queues/disputes" replace />;
  if (!(QUEUES as readonly string[]).includes(queue)) return <p>{t('staff.queue.unknown')}</p>;
  if (me.role !== 'operator') return <FormMessage kind="info">{t('staff.queue.operators_only')}</FormMessage>;
  const q = queue as QueueName;
  return <Queue key={q} queue={q} me={me} t={t} lang={lang} />;
}

function Queue({ queue, me, t, lang }: { queue: QueueName; me: StaffMe; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const items = useQuery({
    queryKey: queueKey(queue),
    queryFn: ({ signal }) => api.get(`/staff/queues/${queue}`, { signal }) as Promise<{ items: QueueItem[] }>,
    staleTime: 0,
    refetchInterval: 60_000,
    retry: false,
  });
  const claim = useMutation({
    mutationFn: (path: string) => api.post(path, {}),
    onSuccess: () => { setMessage({ kind: 'success', text: t('staff.claim.done') }); void queryClient.invalidateQueries({ queryKey: queueKey(queue) }); },
    onError: (e) => {
      const name = problemName(e);
      setMessage({ kind: 'error', text: name && CLAIM_PROBLEMS.has(name) ? t(`staff.claim.${name}`) : errorText(e, t, lang) });
      void queryClient.invalidateQueries({ queryKey: queueKey(queue) });
    },
  });
  const notYet = items.isError && isApiError(items.error, 409) && problemName(items.error) === 'feature-off';
  return (
    <section aria-labelledby="queue-title">
      <h1 id="queue-title" className={styles.pageTitle}>{t(`staff.queue.${queue}`)}</h1>
      <p className={styles.hint}>{t('staff.queue.order')}</p>
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      {items.isPending && <p role="status">{t('shell.loading')}</p>}
      {notYet && <FormMessage kind="info">{t('staff.queue.not_yet')}</FormMessage>}
      {items.isError && !notYet && <FormMessage kind="error">{errorText(items.error, t, lang)}</FormMessage>}
      {items.isSuccess && items.data.items.length === 0 && <p>{t('staff.queue.empty')}</p>}
      {items.isSuccess && items.data.items.length > 0 && (
        // AC-STF-2: a table from 48rem, stacked rows with their labels on phones (AC-STF-3)
        <table className={styles.queue}>
          <thead>
            <tr>
              <th scope="col">{t('staff.queue.col.case')}</th>
              <th scope="col">{t('staff.queue.col.details')}</th>
              <th scope="col" className={styles.num}>{t('staff.queue.col.amount')}</th>
              <th scope="col">{t('staff.queue.col.waiting')}</th>
              <th scope="col">{t('staff.queue.col.who')}</th>
              <th scope="col"><span className={styles.visuallyHidden}>{t('staff.queue.col.action')}</span></th>
            </tr>
          </thead>
          <tbody>
            {items.data.items.map((item) => {
              const path = claimPath(queue, item.id);
              const amount = typeof item.amountCollected === 'string' && item.amountCollected ? formatMoney(BigInt(item.amountCollected), lang) : '';
              const late = item.overdue || item.ageHours >= 24;
              return (
                <tr key={item.id} className={item.overdue ? styles.overdue : undefined}>
                  <th scope="row" data-label={t('staff.queue.col.case')}>{t('staff.queue.ref', { id: short(item.id) })}</th>
                  <td data-label={t('staff.queue.col.details')}><Summary queue={queue} item={item} t={t} lang={lang} /></td>
                  <td data-label={t('staff.queue.col.amount')} className={styles.num}>{amount}</td>
                  <td data-label={t('staff.queue.col.waiting')}>
                    <span className={late ? styles.late : styles.age}>
                      {item.overdue && <>{t('staff.queue.overdue')} · </>}{age(item.ageHours, t, lang)}
                    </span>
                    <span className={styles.since}>{t('staff.queue.since', { at: formatDateTime(Date.parse(item.since), lang) })}</span>
                  </td>
                  <td data-label={t('staff.queue.col.who')}>
                    {item.assignedTo === me.id ? t('staff.claim.yours') : item.assignedTo ? t('staff.claim.other') : path ? t('staff.claim.open') : t('staff.claim.none_needed')}
                  </td>
                  <td className={styles.act}>
                    {casePath(queue, item.id) && (!path || item.assignedTo === me.id) && (
                      <Link className={styles.openLink} to={casePath(queue, item.id)!}>{t('staff.queue.open', { ref: short(item.id) })}</Link>
                    )}
                    {path && !item.assignedTo && (
                      <button type="button" className={styles.claim} disabled={claim.isPending} onClick={() => { setMessage(null); claim.mutate(path); }}>
                        {t('staff.claim.button', { ref: short(item.id) })}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** What each queue's item says about itself, as the server gives it; personal data stays masked (SEC-ACC-05). */
function Summary({ queue, item, t, lang }: { queue: QueueName; item: QueueItem; t: T; lang: Lang }) {
  const now = useServerNow();
  const s = (k: string) => (typeof item[k] === 'string' ? (item[k] as string) : '');
  switch (queue) {
    case 'disputes':
      return (
        <p>
          {t('staff.item.dispute', { type: s('type'), status: s('status') })}
          {s('decisionTargetAt') && ` · ${t('staff.item.decide_by', { when: formatDeadline(Date.parse(s('decisionTargetAt')), now, lang) })}`}
          {item.fourEyes === true && <> · <strong>{t('staff.item.four_eyes')}</strong></>}
        </p>
      );
    case 'reports':
      return <p>{t('staff.item.report', { target: s('targetType'), category: s('category'), status: s('status') })}</p>;
    case 'flagged_activity':
      return <p>{t('staff.item.signal', { kind: s('kind') })}</p>;
    case 'kyc':
      return <p>{t('staff.item.kyc', { doc: s('docType') })}{Array.isArray(item.flags) && item.flags.length > 0 ? ` · ${t('staff.item.flags', { flags: (item.flags as string[]).join(', ') })}` : ''}</p>;
    case 'listings_review':
      return <p><strong>{s('title')}</strong>{s('reason') && ` · ${s('reason')}`}</p>;
    case 'ownership_proofs':
      return <p>{t('staff.item.ownership', { game: s('game'), platform: s('platform'), player: s('playerId') })}</p>;
    case 'payout_accounts':
      return <p>{t('staff.item.payout')}</p>;
    default:
      return null;
  }
}

const short = (id: string) => id.slice(0, 8);
function age(hours: number, t: T, lang: Lang): string {
  const { days, hours: h } = ageParts(hours);
  const n = (x: number) => toLocalDigits(String(x), lang);
  return days > 0 ? t('staff.age.days', { days: n(days), hours: n(h) }) : t('staff.age.hours', { hours: n(h) });
}
