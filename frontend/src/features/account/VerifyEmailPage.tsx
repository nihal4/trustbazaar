// The page of the e-mail verification link (`/verify-email#token=...`; FR-ACC-02, FR-ACC-09; Decisions log, U1-03), on the ruled card (U10-25). The token is
// sent once, even when React runs effects twice in development.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { SubmitButton } from '../../shared/form';
import { useViewport } from '../../shared/gridCell';
import { ME_KEY } from '../../shared/me';
import { problemName } from '../../shared/problems';
import { otherError, useAccountT } from './common';
import { authRows, headFor, StepNote } from './AuthParts';
import { AuthSplit } from './AuthSplit';
import { useLinkToken } from './linkToken';
import styles from './account.module.css';

export function Component() {
  const { t, lang } = useAccountT();
  const { vw } = useViewport();
  const head = headFor(vw, lang === 'bn');
  const api = useApi();
  const navigate = useNavigate();
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

  const rows = authRows(vw, lang === 'bn');
  return (
    <AuthSplit stepKey="verify" rows={rows} headCells={head} head={<h1 id="verify-head">{t('verify_email.title')}</h1>}
      foot={<div className={styles.footLinks}><Link to="/signin" className={styles.link}>{t('signin.link')}</Link></div>}>
      {state === 'done'
        ? (
          <form onSubmit={(e) => { e.preventDefault(); navigate('/account'); }} noValidate className={styles.stepForm}>
            <p role="status" className={styles.stepText}>{t('verify_email.done')}</p>
            <SubmitButton busy={false}>{t('account.link')}</SubmitButton>
          </form>
        )
        : (
          <StepNote>
            {state === 'working' && <p role="status">{t('verify_email.working')}</p>}
            {state === 'invalid' && <p role="alert">{t('link.invalid')}</p>}
            {typeof state === 'object' && <p role="alert">{state.error}</p>}
          </StepNote>
        )}
    </AuthSplit>
  );
}
