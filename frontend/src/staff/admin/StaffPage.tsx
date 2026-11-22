// Staff accounts, /admin/staff (FR-OPS-04; Unit 1 section 6.8; section 7.9; U8-10): the accounts with role and
// status; a new account's first password is shown this once, to hand over in person; an account is disabled with a
// reason; resetting someone's authenticator is proposed for a second administrator (CP-30).
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { fieldErrors } from '../../shared/problems';
import { Action, Choice, Facts, staffError } from '../cases/common';
import { useStaffT } from '../text';
import styles from '../staff.module.css';

interface StaffAccount { id: string; email: string; displayName: string; role: 'operator' | 'administrator'; status: string; createdAt: string; disabledAt?: string | null }
const staffKey = ['admin', 'staff'] as const;

export function Component() {
  const { t, lang } = useStaffT();
  const api = useApi();
  const list = useQuery({
    queryKey: staffKey,
    queryFn: ({ signal }) => api.get('/staff/staff', { signal }) as Promise<StaffAccount[]>,
    staleTime: 0,
    retry: false,
  });
  return (
    <div>
      <h1>{t('admin.staff.title')}</h1>
      <NewAccount t={t} lang={lang} />
      {list.isPending && <p role="status">{t('shell.loading')}</p>}
      {list.isError && <FormMessage kind="error">{staffError(list.error, t, lang)}</FormMessage>}
      <ul className={styles.items}>
        {(list.data ?? []).map((s) => <Account key={s.id} s={s} t={t} lang={lang} />)}
      </ul>
    </div>
  );
}

function NewAccount({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'operator' | 'administrator' | ''>('');
  const [message, setMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const create = useMutation({
    mutationFn: () => api.post('/staff/staff', { email: email.trim(), displayName: name.trim(), role }) as Promise<{ staff: StaffAccount; initialPassword: string }>,
    onSuccess: (r) => {
      setCreated({ email: r.staff.email, password: r.initialPassword });
      setEmail(''); setName(''); setRole(''); setMessage(null);
      void queryClient.invalidateQueries({ queryKey: staffKey });
    },
    onError: (e) => setMessage(fieldErrors(e).some((f) => f.field === 'email') && staffError(e, t, lang) ? t('admin.staff.email_taken') : staffError(e, t, lang)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setCreated(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || name.trim().length < 2 || !role) { setMessage(t('admin.staff.incomplete')); return; }
    create.mutate();
  };
  return (
    <form onSubmit={submit} noValidate className={styles.panel} aria-labelledby="new-staff">
      <h2 id="new-staff">{t('admin.staff.new')}</h2>
      <div className={styles.field}><label htmlFor="staff-email">{t('admin.staff.email')}</label><input id="staff-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className={styles.field}><label htmlFor="staff-name">{t('admin.staff.name')}</label><input id="staff-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <Choice legend={t('admin.staff.role')} name="staff-role" value={role} options={[['operator', t('staff.role.operator')], ['administrator', t('staff.role.administrator')]]} onChange={setRole} />
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {created && (
        <div role="status" className={styles.warning}>
          <p>{t('admin.staff.created', { email: created.email })}</p>
          <p><strong className={styles.code}>{created.password}</strong></p>
          <p>{t('admin.staff.password_once')}</p>
        </div>
      )}
      <p><button type="submit" className={styles.primary} disabled={create.isPending}>{t('admin.staff.create')}</button></p>
    </form>
  );
}

function Account({ s, t, lang }: { s: StaffAccount; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const active = s.status !== 'disabled';
  return (
    <li>
      <p><strong>{s.displayName}</strong> · {s.email} · {t(`staff.role.${s.role}`)} · {t(active ? 'admin.staff.active' : 'admin.staff.disabled')}</p>
      <Facts rows={[[t('admin.staff.since'), formatDateTime(Date.parse(s.createdAt), lang)]]} />
      {active && !open && <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>{t('admin.staff.manage', { name: s.displayName })}</button>}
      {active && open && (
        <>
          <Action title={t('admin.staff.disable_title', { name: s.displayName })} button={t('admin.staff.disable')} consequence={t('admin.staff.disable_consequence')} t={t} lang={lang}
            run={(reason) => api.post(`/staff/staff/${encodeURIComponent(s.id)}/disable`, { reason })} done={() => t('admin.staff.disabled_done')}
            onDone={() => void queryClient.invalidateQueries({ queryKey: staffKey })} />
          <Action title={t('admin.staff.mfa_title', { name: s.displayName })} button={t('admin.staff.mfa')} consequence={t('staff.member.four_eyes_consequence')} t={t} lang={lang}
            run={(reason) => api.post(`/staff/staff/${encodeURIComponent(s.id)}/mfa-reset`, { reason })} done={() => t('staff.member.proposed')} />
        </>
      )}
    </li>
  );
}
