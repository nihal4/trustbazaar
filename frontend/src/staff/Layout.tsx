// The console around every signed-in page (section 7.9; FR-OPS-04; U8-10): who is signed in and their role, the
// pages that role may use, sign-out, and the session's CP-03 limits. The operator's pages are the eight queues and
// the approvals and the terms; an administrator's are the approvals and the administration. The server
// authorises every request; the navigation only leaves out what the role cannot do.
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../shared/api';
import { errorText } from '../shared/errors';
import { FormMessage } from '../shared/form';
import { isApiError } from '../shared/problems';
import { useStaffMe } from './model';
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
    onSettled: () => { queryClient.clear(); void navigate('/staff/signin', { replace: true }); },
  });
  if (me.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (me.isError) return isApiError(me.error, 401) ? <p role="status">{t('shell.loading')}</p> : <FormMessage kind="error">{errorText(me.error, t, lang)}</FormMessage>;
  const s = me.data;
  const operator = s.role === 'operator';
  return (
    <div className={styles.console}>
      <div className={styles.bar}>
        <p><strong>{s.displayName}</strong> · {t(`staff.role.${s.role}`)}</p>
        <nav aria-label={t('staff.nav')}>
          <ul className={styles.nav}>
            {operator && <li><NavLink to="/staff/queues">{t('staff.nav.queues')}</NavLink></li>}
            {operator && <li><NavLink to="/staff/terms">{t('staff.nav.terms')}</NavLink></li>}
            <li><NavLink to="/staff/approvals">{t('staff.nav.approvals')}</NavLink></li>
            {!operator && <li><NavLink to="/admin/config">{t('staff.nav.config')}</NavLink></li>}
            {!operator && <li><NavLink to="/admin/staff">{t('staff.nav.staff')}</NavLink></li>}
            {!operator && <li><NavLink to="/admin/reference">{t('staff.nav.reference')}</NavLink></li>}
            {!operator && <li><NavLink to="/admin/audit">{t('staff.nav.audit')}</NavLink></li>}
          </ul>
        </nav>
        <button type="button" className={styles.secondary} disabled={signOut.isPending} onClick={() => signOut.mutate()}>{t('staff.sign_out')}</button>
      </div>
      {s.session && <SessionTimer session={s.session} />}
      <Outlet context={s} />
    </div>
  );
}
