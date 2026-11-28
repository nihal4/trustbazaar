// The versions of the configuration published so far, newest first.
import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { staffError } from '../cases/common';
import styles from '../staff.module.css';

export function Versions({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const v = useQuery({
    queryKey: ['admin', 'config', 'versions'],
    queryFn: ({ signal }) =>
      api.get('/admin/config/versions', { signal }) as Promise<
        { version: number; createdBy: string | null; reason: string; approvalId: string | null; createdAt: string }[]
      >,
    staleTime: 0,
    retry: false,
  });
  return (
    <section className={styles.panel} aria-labelledby="versions">
      <h2 id="versions">{t('admin.config.versions')}</h2>
      {v.isError && <FormMessage kind="error">{staffError(v.error, t, lang)}</FormMessage>}
      <ol className={styles.items}>
        {(v.data ?? []).map((x) => (
          <li key={x.version}>
            <strong>{t('admin.config.version', { version: String(x.version) })}</strong> · {formatDateTime(Date.parse(x.createdAt), lang)}
            {x.approvalId ? ` · ${t('admin.config.approved')}` : ''}
            <p className={styles.text}>{x.reason}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
