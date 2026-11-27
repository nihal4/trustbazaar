// The console around every signed-in page (section 7.9; FR-OPS-04; U8-10): who is signed in and their role, the
// pages that role may use, sign-out, and the session's CP-03 limits. The operator's pages are the eight queues and
// the approvals and the terms; an administrator's are the approvals and the administration. The server
// authorises every request; the navigation only leaves out what the role cannot do. Daylight design
// (docs/design/10_visual.md, section 7.10, AC-STF-1): a dark navigation on the left from 60rem, above the page on
// smaller screens; each queue with the number of cases waiting in it, read from the same answers as the queue pages.
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { toLocalDigits } from '../lib/money.js';
import { useApi } from '../shared/api';
import { errorText } from '../shared/errors';
import { FormMessage } from '../shared/form';
import { isApiError } from '../shared/problems';
import type { T } from '../shared/language/catalogue';
import type { Lang } from '../shared/language/lang';
import { QUEUE_LIMIT, queueKey, QUEUES, useStaffMe, type QueueItem } from './model';
import { SessionTimer } from './SessionTimer';
import { useStaffT } from './text';
import styles from './staff.module.css';

export function Component() {
  const { t, lang } = useStaffT();
  const me = useStaffMe();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => api.post('/staff/auth/signout', {}),
    onSettled: () => {
      queryClient.clear();
      void navigate('/staff/signin', { replace: true });
    },
  });
  if (me.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (me.isError)
    return isApiError(me.error, 401) ? <p role="status">{t('shell.loading')}</p> : <FormMessage kind="error">{errorText(me.error, t, lang)}</FormMessage>;
  const s = me.data;
  const operator = s.role === 'operator';
  return (
    <div className={styles.console}>
      <aside className={styles.side}>
        <p className={styles.who}>
          <strong>{s.displayName}</strong>
          <span>{t(`staff.role.${s.role}`)}</span>
        </p>
        <nav aria-label={t('staff.nav')}>
          {operator && (
            <>
              <QueueLinks t={t} lang={lang} />
              <p className={styles.group}>{t('staff.nav.more')}</p>
              <ul className={styles.nav}>
                <li>
                  <NavLink to="/staff/approvals">{t('staff.nav.approvals')}</NavLink>
                </li>
                <li>
                  <NavLink to="/staff/terms">{t('staff.nav.terms')}</NavLink>
                </li>
              </ul>
            </>
          )}
          {!operator && (
            <>
              <ul className={styles.nav}>
                <li>
                  <NavLink to="/staff/approvals">{t('staff.nav.approvals')}</NavLink>
                </li>
              </ul>
              <p className={styles.group}>{t('staff.nav.administration')}</p>
              <ul className={styles.nav}>
                <li>
                  <NavLink to="/admin/config">{t('staff.nav.config')}</NavLink>
                </li>
                <li>
                  <NavLink to="/admin/staff">{t('staff.nav.staff')}</NavLink>
                </li>
                <li>
                  <NavLink to="/admin/reference">{t('staff.nav.reference')}</NavLink>
                </li>
                <li>
                  <NavLink to="/admin/audit">{t('staff.nav.audit')}</NavLink>
                </li>
              </ul>
            </>
          )}
        </nav>
        <button type="button" className={styles.signOut} disabled={signOut.isPending} onClick={() => signOut.mutate()}>
          {t('staff.sign_out')}
        </button>
      </aside>
      <div className={styles.content}>
        {s.session && <SessionTimer session={s.session} />}
        <Outlet context={s} />
      </div>
    </div>
  );
}

/** The eight queues with the number waiting in each (AC-STF-1): the same queries as the queue pages, so one answer
 *  serves both, refreshed every minute. A queue that is not available yet, or that could not be read, shows no number. */
function QueueLinks({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const counts = useQueries({
    queries: QUEUES.map((q) => ({
      queryKey: queueKey(q),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get(`/staff/queues/${q}`, { signal }) as Promise<{ items: QueueItem[] }>,
      staleTime: 0,
      refetchInterval: 60_000,
      retry: false,
    })),
  });
  return (
    <ul className={styles.nav}>
      {QUEUES.map((q, i) => {
        const n = counts[i].data?.items.length;
        return (
          <li key={q}>
            <NavLink to={`/staff/queues/${q}`}>
              <span>{t(`staff.queue.${q}`)}</span>
              {n !== undefined && n > 0 && (
                <span className={styles.count}>
                  {toLocalDigits(String(n), lang)}
                  {n >= QUEUE_LIMIT ? '+' : ''}
                  <span className={styles.visuallyHidden}>{t('staff.nav.waiting')}</span>
                </span>
              )}
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}
