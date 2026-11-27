// The page of the reset link (`/reset-password#token=...`; Decisions log, U1-05), on the ruled card (U10-25).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useViewport } from '../../shared/gridCell';
import { useAccountT } from './common';
import { authRows, headFor, StepNote } from './AuthParts';
import { AuthSplit } from './AuthSplit';
import { useLinkToken } from './linkToken';
import { NewPasswordForm, ResetDone } from './NewPassword';
import styles from './account.module.css';

export function Component() {
  const { t, lang } = useAccountT();
  const { vw } = useViewport();
  const head = headFor(vw, lang === 'bn');
  const rows = authRows(vw, lang === 'bn');
  const token = useLinkToken();
  const [invalid, setInvalid] = useState(token === null);
  const [done, setDone] = useState(false);
  const heading = <h1 id="reset-head">{t('reset.title')}</h1>;
  if (done) return <ResetDone rows={rows} head={head} />;
  if (invalid || !token) {
    return (
      <AuthSplit
        stepKey="invalid"
        rows={rows}
        headCells={head}
        head={heading}
        foot={
          <div className={styles.footLinks}>
            <Link to="/reset" className={styles.link}>
              {t('reset.again')}
            </Link>
          </div>
        }
      >
        <StepNote>
          <p role="alert">{t('link.invalid')}</p>
        </StepNote>
      </AuthSplit>
    );
  }
  return (
    <AuthSplit
      stepKey="new"
      rows={rows}
      headCells={head}
      head={heading}
      foot={
        <div className={styles.footLinks}>
          <Link to="/signin" className={styles.link}>
            {t('signin.back')}
          </Link>
        </div>
      }
    >
      <NewPasswordForm proof={{ token }} onDone={() => setDone(true)} onLinkRefused={() => setInvalid(true)} />
    </AuthSplit>
  );
}
