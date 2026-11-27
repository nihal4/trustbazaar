// The live sessions on the security page (FR-ACC-08): device and last use, this device marked, ending one session or all the others.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { isApiError } from '../../shared/problems';
import { Popup } from '../../shared/Popup';
import { formatDateTime } from '../../lib/time.js';
import { digits, otherError, useAccountT } from './common';
import styles from './account.module.css';
import { Button } from '../../shared/ui';
import { SessionSummary, SESSIONS_KEY, SESSIONS_SHOWN } from './securityShared';

export function Sessions({ list, error }: { list: SessionSummary[]; error: unknown }) {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const run = async (id: string, call: () => Promise<{ ended?: number } | null>) => {
    if (busy) return;
    setBusy(id);
    setMessage(null);
    try {
      const r = await call();
      if (r && typeof r.ended === 'number') setMessage({ kind: 'success', text: t('sessions.ended_others', { count: digits(r.ended, lang) }) });
    } catch (err) {
      if (!isApiError(err, 404)) setMessage({ kind: 'error', text: otherError(err, t, lang) });
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    }
  };

  const others = list.filter((s) => !s.current);
  // this device first, then the others newest first; the two latest are shown, and all of them in a popup (a long history is not a long page)
  const [all, setAll] = useState(false);
  const ordered = [...list].sort((a, b) => Number(b.current) - Number(a.current));
  const item = (s: SessionSummary) => (
    <li key={s.id}>
      <p className={styles.device}>
        {s.device ?? t('sessions.unknown_device')}
        {s.current && <strong> · {t('sessions.this_device')}</strong>}
      </p>
      {s.approxLocation && <p>{s.approxLocation}</p>}
      <p>{t('sessions.last_used', { at: formatDateTime(Date.parse(s.lastSeenAt), lang) })}</p>
      <p>{t('sessions.started', { at: formatDateTime(Date.parse(s.createdAt), lang) })}</p>
      {!s.current && (
        <button type="button" disabled={busy !== null} onClick={() => void run(s.id, () => api.del(`/auth/sessions/${encodeURIComponent(s.id)}`))}>
          {t('sessions.end')}
        </button>
      )}
    </li>
  );
  return (
    <section aria-labelledby="sessions-title" className={styles.section}>
      <h2 id="sessions-title">{t('sessions.title')}</h2>
      {error !== null && <FormMessage kind="error">{otherError(error, t, lang)}</FormMessage>}
      {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
      <ul className={styles.sessions}>{ordered.slice(0, SESSIONS_SHOWN).map(item)}</ul>
      {(ordered.length > SESSIONS_SHOWN || others.length > 0) && (
        <div className={styles.buttonRow}>
          {ordered.length > SESSIONS_SHOWN && (
            <Button variant="secondary" type="button" aria-haspopup="dialog" onClick={() => setAll(true)}>
              {t('sessions.show_all', { count: digits(ordered.length, lang) })}
            </Button>
          )}
          {others.length > 0 && (
            <Button
              variant="secondary"
              type="button"
              disabled={busy !== null}
              onClick={() => void run('others', () => api.request('POST', '/auth/sessions/end-others'))}
            >
              {t('sessions.end_others')}
            </Button>
          )}
        </div>
      )}
      {all && (
        <Popup id="sessions-popup" title={t('sessions.title')} closeLabel={t('legal.close')} onClose={() => setAll(false)}>
          {message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}
          <ul className={`${styles.sessions} ${styles.sessionsPopup}`}>{ordered.map(item)}</ul>
        </Popup>
      )}
    </section>
  );
}
