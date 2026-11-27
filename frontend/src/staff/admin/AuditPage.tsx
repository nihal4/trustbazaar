// The audit log, read-only, /admin/audit (SEC-LOG-01, SEC-LOG-02; section 7.9; U8-10): newest first, filtered by
// actor, object, action and time; older entries page by the chain position; "Check the chain" recomputes every hash
// on the server and says whether the log is intact. Nothing here changes the log: the API has no way to.
import { useState, type FormEvent } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { staffError } from '../cases/common';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Text } from './forms';
import { Button, Field, Input } from '../../shared/ui';

interface Entry {
  id: string;
  chainPos: string;
  at: string;
  actorType: string;
  actorId: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  approvalId: string | null;
  sourceIp: string | null;
  correlationId: string | null;
}
const PAGE = 50;
const UUID = /^[0-9a-f-]{36}$/i;

export function Component() {
  const { t, lang } = useStaffT();
  const api = useApi();
  const [form, setForm] = useState({ actorId: '', objectId: '', action: '', from: '', to: '' });
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [chain, setChain] = useState<{ intact: boolean; entries: number; firstBadId?: string } | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const log = useInfiniteQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: ({ pageParam, signal }) => {
      const q = new URLSearchParams({ ...filters, limit: String(PAGE), ...(pageParam ? { before: pageParam } : {}) });
      return api.get(`/staff/audit?${q}`, { signal }) as Promise<Entry[]>;
    },
    initialPageParam: '',
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1].chainPos : undefined),
    staleTime: 0,
    retry: false,
  });
  const apply = (e: FormEvent) => {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (form.actorId.trim()) {
      if (!UUID.test(form.actorId.trim())) {
        setProblem(t('admin.audit.bad_id'));
        return;
      }
      f.actorId = form.actorId.trim();
    }
    if (form.objectId.trim()) {
      if (!UUID.test(form.objectId.trim())) {
        setProblem(t('admin.audit.bad_id'));
        return;
      }
      f.objectId = form.objectId.trim();
    }
    if (form.action.trim()) {
      if (!/^[a-z_.]{1,80}$/.test(form.action.trim())) {
        setProblem(t('admin.audit.bad_action'));
        return;
      }
      f.action = form.action.trim();
    }
    // dates are Dhaka days (NFR-USE-08)
    if (form.from) f.from = new Date(`${form.from}T00:00:00+06:00`).toISOString();
    if (form.to) f.to = new Date(`${form.to}T23:59:59.999+06:00`).toISOString();
    setProblem(null);
    setFilters(f);
  };
  const verify = async () => {
    setChainError(null);
    try {
      setChain((await api.get('/staff/audit/verify')) as typeof chain);
    } catch (e) {
      setChainError(staffError(e, t, lang));
    }
  };
  const entries = log.data?.pages.flat() ?? [];
  return (
    <div>
      <h1>{t('admin.audit.title')}</h1>
      <section className={styles.panel} aria-labelledby="chain">
        <h2 id="chain">{t('admin.audit.chain')}</h2>
        <p className={styles.hint}>{t('admin.audit.chain_explain')}</p>
        <Button variant="secondary" type="button" onClick={() => void verify()}>
          {t('admin.audit.verify')}
        </Button>
        {chainError && <FormMessage kind="error">{chainError}</FormMessage>}
        {chain &&
          (chain.intact ? (
            <FormMessage kind="success">{t('admin.audit.intact', { entries: String(chain.entries) })}</FormMessage>
          ) : (
            <FormMessage kind="error">{t('admin.audit.broken', { id: chain.firstBadId ?? '—' })}</FormMessage>
          ))}
      </section>
      <form onSubmit={apply} noValidate className={styles.panel} aria-labelledby="audit-filters">
        <h2 id="audit-filters">{t('admin.audit.filters')}</h2>
        <div className={styles.fields}>
          <Text id="audit-actor" label={t('admin.audit.actor')} value={form.actorId} onChange={(v) => setForm({ ...form, actorId: v })} maxLength={36} />
          <Text id="audit-object" label={t('admin.audit.object')} value={form.objectId} onChange={(v) => setForm({ ...form, objectId: v })} maxLength={36} />
          <Text
            id="audit-action"
            label={t('admin.audit.action')}
            value={form.action}
            onChange={(v) => setForm({ ...form, action: v })}
            hint={t('admin.audit.action_hint')}
            maxLength={80}
          />
          <Field id="audit-from" label={t('admin.audit.from')}>
            {(control) => <Input {...control} type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />}
          </Field>
          <Field id="audit-to" label={t('admin.audit.to')}>
            {(control) => <Input {...control} type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />}
          </Field>
        </div>
        {problem && <FormMessage kind="error">{problem}</FormMessage>}
        <p>
          <Button variant="primary" type="submit">
            {t('admin.audit.show')}
          </Button>
        </p>
      </form>
      {log.isPending && <p role="status">{t('shell.loading')}</p>}
      {log.isError && <FormMessage kind="error">{staffError(log.error, t, lang)}</FormMessage>}
      {log.isSuccess && entries.length === 0 && <p>{t('admin.audit.none')}</p>}
      <ol className={styles.items} aria-label={t('admin.audit.entries')}>
        {entries.map((e) => (
          <li key={e.id}>
            <p>
              <strong>{e.action}</strong> · {formatDateTime(Date.parse(e.at), lang)} · #{e.chainPos}
            </p>
            <p className={styles.hint}>
              {t('admin.audit.by', { type: e.actorType, id: e.actorId ?? '—' })}
              {e.objectType ? ` · ${t('admin.audit.on', { type: e.objectType, id: e.objectId ?? '—' })}` : ''}
              {e.approvalId ? ` · ${t('admin.audit.approved', { id: e.approvalId.slice(0, 8) })}` : ''}
            </p>
            {e.reason && <p className={styles.text}>{t('admin.audit.reason', { reason: e.reason })}</p>}
            {(e.before !== null || e.after !== null) && (
              <p className={styles.code}>
                {e.before !== null && e.before !== undefined ? `${JSON.stringify(e.before)} → ` : ''}
                {JSON.stringify(e.after ?? null)}
              </p>
            )}
          </li>
        ))}
      </ol>
      {log.hasNextPage && (
        <Button variant="secondary" type="button" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          {t('admin.audit.older')}
        </Button>
      )}
    </div>
  );
}
