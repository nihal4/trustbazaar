// The page of the e-mail verification link (`/verify-email#token=...`; FR-ACC-02, FR-ACC-09; Decisions
// log, U1-03). The token is sent once, even when React runs effects twice in development.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { ME_KEY } from '../../shared/me';
import { problemName } from '../../shared/problems';
import { otherError, useAccountT } from './common';
import { useLinkToken } from './linkToken';
import styles from './account.module.css';

export function Component() {
  const { t, lang } = useAccountT();
  const api = useApi();
  const queryClient = useQueryClient();
  const token = useLinkToken();
  const sent = useRef(false);
  const [state, setState] = useState<'working' | 'done' | 'invalid' | { error: string }>(token ? 'working' : 'invalid');

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    api.post('/auth/email/verify', { token })
      .then(() => { setState('done'); void queryClient.invalidateQueries({ queryKey: ME_KEY }); })
      .catch((err: unknown) => setState(problemName(err) === 'link-invalid' || problemName(err) === 'validation-failed'
        ? 'invalid' : { error: otherError(err, t, lang) }));
  }, [token, api, queryClient, t, lang]);

  return (
    <div className={styles.narrow}>
      <h1>{t('verify_email.title')}</h1>
      {state === 'working' && <p role="status">{t('verify_email.working')}</p>}
      {state === 'done' && (
        <FormMessage kind="success">
          <p>{t('verify_email.done')}</p>
          <p><Link to="/account">{t('account.link')}</Link></p>
        </FormMessage>
      )}
      {state === 'invalid' && <FormMessage kind="error">{t('link.invalid')}</FormMessage>}
      {typeof state === 'object' && <FormMessage kind="error">{state.error}</FormMessage>}
    </div>
  );
}
