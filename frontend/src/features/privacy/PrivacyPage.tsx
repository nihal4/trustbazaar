// The privacy screens, /account/privacy (docs/design/08_frontend.pdf section 3.3; FR-PRV-03, FR-ACC-11, DV-49;
// U8-09): a copy of one's data, asked for after step-up ('data.export'), once in 7 days, prepared within minutes and
// downloadable for 7 days behind a signed link; and closing the account after step-up ('account.close'), refused with
// the reasons while something is still open. Closing ends every session; the page then says so, with a link home.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { AccountTabs } from '../../shared/AccountTabs';
import { ConfirmDialog } from '../../shared/ConfirmDialog';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import { useT } from '../../shared/language/Language';
import type { Lang } from '../../shared/language/lang';
import { fieldErrors, isApiError, problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { StepUpCancelled } from '../../shared/stepUp';
import en from '../../messages/en/privacy.json';
import bn from '../../messages/bn/privacy.json';
import styles from './privacy.module.css';

const CATALOGUES = { en, bn };

interface ExportStatus {
  id: string;
  status: 'preparing' | 'ready' | 'expired';
  requestedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  download: { url: string; expiresAt: string } | null;
}
const exportKey = ['me', 'data-export'] as const;
/** The download link is served under /api/v1; it opens as a file in the same session. */
const fileHref = (url: string) => (url.startsWith('/api/') ? url : `/api/v1${url}`);

export function Component() {
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const exp = useQuery({
    queryKey: exportKey,
    queryFn: async ({ signal }) => ((await api.get('/me/data-export', { signal })) ?? null) as ExportStatus | null,
    staleTime: FRESHNESS.account,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'preparing' ? 30_000 : false),
  });
  if (exp.isError && isApiError(exp.error, 401))
    return (
      <p>
        <Link to={signInPath('/account/privacy')}>{t('privacy.sign_in')}</Link>
      </p>
    );
  return (
    <div className={styles.page}>
      <AccountTabs t={t} />
      <h1>{t('privacy.title')}</h1>
      <p className={styles.lead}>
        {t('privacy.intro')} <Link to="/help/privacy">{t('privacy.notice_link')}</Link>
      </p>
      <div className={styles.cols}>
        <DataExport status={exp.data ?? null} loading={exp.isPending} error={exp.isError ? exp.error : null} t={t} lang={lang} />
        <CloseAccount t={t} lang={lang} />
      </div>
    </div>
  );
}

function DataExport({ status, loading, error, t, lang }: { status: ExportStatus | null; loading: boolean; error: unknown; t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: () => api.post('/me/data-export', {}, { stepUpAction: 'data.export' }) as Promise<ExportStatus>,
    onSuccess: (s) => {
      setMessage(null);
      queryClient.setQueryData(exportKey, s);
    },
    onError: (e) => {
      if (e instanceof StepUpCancelled) return;
      const name = problemName(e);
      if (isApiError(e, 429)) {
        const after = (e as { retryAfter?: number }).retryAfter;
        return setMessage(after ? t('export.once_a_week_until', { at: formatDateTime(Date.now() + after * 1000, lang) }) : t('export.once_a_week'));
      }
      setMessage(name === 'request-in-progress' ? t('export.in_progress') : errorText(e, t, lang));
      void queryClient.invalidateQueries({ queryKey: exportKey });
    },
  });
  const canAsk = !status || status.status !== 'preparing';
  return (
    <section aria-labelledby="export-title" className={styles.panel}>
      <h2 id="export-title">{t('export.title')}</h2>
      <p>{t('export.intro')}</p>
      {loading && <p role="status">{t('shell.loading')}</p>}
      {error !== null && !isApiError(error, 401) && <FormMessage kind="error">{errorText(error, t, lang)}</FormMessage>}
      {status?.status === 'preparing' && <p role="status">{t('export.preparing', { at: formatDateTime(Date.parse(status.requestedAt), lang) })}</p>}
      {status?.status === 'ready' && status.download && (
        <div className={styles.ready}>
          <p>{t('export.ready', { until: formatDateTime(Date.parse(status.download.expiresAt), lang) })}</p>
          <p>
            <a className={styles.primaryLink} href={fileHref(status.download.url)} download="trustbazaar-data.zip">
              {t('export.download')}
            </a>
          </p>
          {status.expiresAt && <p className={styles.hint}>{t('export.deleted_on', { at: formatDateTime(Date.parse(status.expiresAt), lang) })}</p>}
        </div>
      )}
      {status?.status === 'expired' && <p className={styles.hint}>{t('export.expired')}</p>}
      {message && <FormMessage kind="error">{message}</FormMessage>}
      {canAsk && !loading && (
        <button type="button" className={styles.secondary} disabled={ask.isPending} onClick={() => ask.mutate()}>
          {t(status ? 'export.ask_again' : 'export.ask')}
        </button>
      )}
    </section>
  );
}

function CloseAccount({ t, lang }: { t: T; lang: Lang }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [closed, setClosed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reasons, setReasons] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const close = useMutation({
    mutationFn: () => api.post('/me/close', {}, { stepUpAction: 'account.close' }),
    onSuccess: () => {
      setConfirming(false);
      setClosed(true);
      queryClient.clear();
    },
    onError: (e) => {
      setConfirming(false);
      if (e instanceof StepUpCancelled) return;
      if (problemName(e) === 'account-not-closable') {
        setMessage(null);
        return setReasons(fieldErrors(e).map((f) => f.reason));
      }
      setReasons([]);
      setMessage(errorText(e, t, lang));
    },
  });
  if (closed) {
    return (
      <section aria-labelledby="close-title" className={styles.panel}>
        <h2 id="close-title">{t('close.title')}</h2>
        <FormMessage kind="success">{t('close.done')}</FormMessage>
        <p>
          <a href="/">{t('close.home')}</a>
        </p>
      </section>
    );
  }
  return (
    <section aria-labelledby="close-title" className={styles.panel}>
      <h2 id="close-title">{t('close.title')}</h2>
      <p>{t('close.intro')}</p>
      <ul className={styles.effects}>
        <li>{t('close.effect.sessions')}</li>
        <li>{t('close.effect.listings')}</li>
        <li>{t('close.effect.erasure')}</li>
        <li>{t('close.effect.records')}</li>
      </ul>
      {reasons.length > 0 && (
        <FormMessage kind="error">
          {t('close.refused')}
          <ul>
            {reasons.map((r) => (
              <li key={r}>{t(`close.reason.${r}`)}</li>
            ))}
          </ul>
        </FormMessage>
      )}
      {message && <FormMessage kind="error">{message}</FormMessage>}
      <button type="button" className={styles.danger} onClick={() => setConfirming(true)} disabled={close.isPending}>
        {t('close.button')}
      </button>
      {confirming && (
        <ConfirmDialog
          id="close-account"
          title={t('close.title')}
          busy={close.isPending}
          confirmLabel={t('close.confirm_button')}
          cancelLabel={t('close.keep')}
          onConfirm={() => close.mutate()}
          onCancel={() => setConfirming(false)}
        >
          <p>{t('close.confirm')}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
