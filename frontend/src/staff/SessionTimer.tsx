// The staff session's CP-03 limits (SEC-SES-06; section 7.9; Decisions log, U8-10). The server ends a staff session
// at its idle end, which only a refresh moves. While the staff member is working, the console refreshes two minutes
// before the idle end; if nothing was done since the last refresh, it warns a minute before instead, with "Stay
// signed in". The absolute end (8 hours) cannot be moved: a minute before, it says so. At the end, the next request
// meets the server's refusal and the console goes to the sign-in, coming back afterwards.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { formatCountdown, formatDateTime } from '../lib/time.js';
import { useApi } from '../shared/api';
import { useServerNow } from '../shared/clock';
import { STAFF_ME_KEY } from '../shared/me';
import type { StaffMe } from './model';
import { useStaffT } from './text';
import styles from './staff.module.css';

const AUTO = 120_000;
const WARN = 60_000;

export function SessionTimer({ session }: { session: NonNullable<StaffMe['session']> }) {
  const { t, lang } = useStaffT();
  const api = useApi();
  const queryClient = useQueryClient();
  const now = useServerNow();
  const lastActive = useRef(0);
  const refreshedAt = useRef(Date.now());
  const busy = useRef(false);
  const ended = useRef(false);
  const [failed, setFailed] = useState(false);
  const idleAt = Date.parse(session.idleExpiresAt);
  const absoluteAt = Date.parse(session.absoluteExpiresAt);

  useEffect(() => {
    const mark = () => { lastActive.current = Date.now(); };
    for (const e of ['pointerdown', 'keydown'] as const) document.addEventListener(e, mark, { capture: true, passive: true });
    return () => { for (const e of ['pointerdown', 'keydown'] as const) document.removeEventListener(e, mark, { capture: true }); };
  }, []);

  const refresh = async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      await api.post('/staff/auth/refresh', {});
      refreshedAt.current = Date.now();
      setFailed(false);
      await queryClient.refetchQueries({ queryKey: STAFF_ME_KEY });
    } catch {
      setFailed(true);
    } finally {
      busy.current = false;
    }
  };

  const left = idleAt - now;
  const worked = lastActive.current > refreshedAt.current;
  useEffect(() => {
    if (left > 0 && left <= AUTO && worked && idleAt < absoluteAt) void refresh();
    if (left <= 0 && !ended.current) {
      ended.current = true;
      void api.get('/staff/me').catch(() => undefined); // the server's refusal signs the console out
    }
  });

  if (absoluteAt - now <= WARN && absoluteAt <= idleAt) {
    return <div role="alert" className={styles.warning}>{t('staff.session.absolute', { at: formatDateTime(absoluteAt, lang) })}</div>;
  }
  if (left > WARN || left <= 0) return failed ? <div role="alert" className={styles.warning}>{t('staff.session.refresh_failed')}</div> : null;
  return (
    <div role="alert" className={styles.warning}>
      <p>{t('staff.session.idle', { left: formatCountdown(left, lang).text })}</p>
      <button type="button" className={styles.primary} onClick={() => void refresh()}>{t('staff.session.stay')}</button>
    </div>
  );
}
