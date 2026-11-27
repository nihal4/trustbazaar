// Account security (IF-UI-01; FR-ACC-06, FR-ACC-08, FR-ACC-09, SEC-AUTH-11): the live sessions with
// device and last use, "this device" marked; ending sessions; password, mobile number and e-mail
// changes, each behind step-up (SEC-AUTH-08); the authenticator app and recovery codes (MfaSettings).

import { useQuery } from '@tanstack/react-query';
import { useApi } from '../../shared/api';
import { AccountTabs } from '../../shared/AccountTabs';

import { useMe } from '../../shared/me';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';

import { SignInPrompt } from './AccountPage';
import { MfaSettings } from './MfaSettings';
import { SettingRow } from './SettingRow';
import { useAccountT } from './common';

import styles from './account.module.css';

import { Sessions } from './SecuritySessions';
import { SessionSummary, SESSIONS_KEY } from './securityShared';
import { PasswordForm } from './SecurityPasswordForm';
import { PhoneForm } from './SecurityPhoneForm';
import { EmailForm } from './SecurityEmailForm';
import { EmailCodeSetting } from './SecurityEmailCodeSetting';

export function Component() {
  const { t } = useAccountT();
  const api = useApi();
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: ({ signal }) => api.get('/auth/sessions', { signal }) as Promise<SessionSummary[]>,
    staleTime: FRESHNESS.account,
    retry: false,
  });

  if (sessions.isPending) return <p role="status">{t('shell.loading')}</p>;
  if (sessions.isError && isApiError(sessions.error, 401)) return <SignInPrompt next="/account/security" />;

  return (
    <div className={styles.secPage}>
      <AccountTabs t={t} />
      <h1>{t('security.title')}</h1>
      {/* two columns divided by one line, as the profile and the dashboard: where you are signed in on the left, the settings on the right */}
      <div className={styles.secCols}>
        <div className={styles.secCol}>
          <Sessions list={sessions.data ?? []} error={sessions.isError ? sessions.error : null} />
        </div>
        <div className={styles.secCol}>
          <EmailCodeSetting />
          {/* the rest are rows that open their form in a popup, so the page stays short */}
          <ul className={styles.settingRows}>
            <PasswordChange />
            <MfaSettings sessionsKey={SESSIONS_KEY} />
            <PhoneChange />
            <EmailChange />
          </ul>
        </div>
      </div>
    </div>
  );
}

function PasswordChange() {
  const { t } = useAccountT();
  return (
    <SettingRow id="password-popup" title={t('password.change_title')}>
      <PasswordForm />
    </SettingRow>
  );
}

function PhoneChange() {
  const { t } = useAccountT();
  const me = useMe();
  return (
    <SettingRow id="phone-popup" title={t('contact.phone_title')} summary={me.data?.phoneMasked}>
      <PhoneForm />
    </SettingRow>
  );
}

function EmailChange() {
  const { t } = useAccountT();
  const me = useMe();
  return (
    <SettingRow id="email-popup" title={t('contact.email_title')} summary={me.data?.email}>
      <EmailForm />
    </SettingRow>
  );
}
