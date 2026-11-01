// The page of the reset link (`/reset-password#token=...`; Decisions log, U1-05).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FormMessage } from '../../shared/form';
import { useAccountT } from './common';
import { useLinkToken } from './linkToken';
import { NewPasswordForm } from './NewPassword';
import styles from './account.module.css';

export function Component() {
  const { t } = useAccountT();
  const token = useLinkToken();
  const [invalid, setInvalid] = useState(token === null);
  return (
    <div className={styles.narrow}>
      <h1>{t('reset.title')}</h1>
      {invalid || !token
        ? (
          <FormMessage kind="error">
            <p>{t('link.invalid')}</p>
            <p><Link to="/reset">{t('reset.again')}</Link></p>
          </FormMessage>
        )
        : <NewPasswordForm proof={() => ({ token })} onProofRefused={() => setInvalid(true)} />}
    </div>
  );
}
