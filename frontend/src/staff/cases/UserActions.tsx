// What an operator may do about a member named in a case (FR-OPS-02, FR-TNS-01 to FR-TNS-05, FR-KYC-10, FR-OPS-06;
// U8-10): apply a sanction, propose revoking the verification or adding the identity to the NID blacklist (both
// four-eyes), and declare a conflict of interest, which hands the case to another operator. Each with a reason.
import { useState } from 'react';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { useApi } from '../../shared/api';
import styles from '../staff.module.css';
import { Action, Choice, short } from './common';

const KINDS = ['warning', 'listing_removal', 'selling_suspended', 'buying_suspended', 'account_suspended'] as const;
type Kind = (typeof KINDS)[number];

export function UserActions({ userId, related, t, lang }: { userId: string; related?: { type: 'report' | 'dispute' | 'signal'; id: string }; t: T; lang: Lang }) {
  const api = useApi();
  const [kind, setKind] = useState<Kind | ''>('');
  const [until, setUntil] = useState('');
  const [fraud, setFraud] = useState(false);
  const u = encodeURIComponent(userId);
  const ends = until ? new Date(`${until}T23:59:59+06:00`) : null; // the end of that day in Dhaka (NFR-USE-08)
  const validEnd = !ends || (Number.isFinite(ends.getTime()) && ends.getTime() > Date.now());
  return (
    <section aria-labelledby={`member-${userId}`}>
      <h2 id={`member-${userId}`}>{t('staff.member.title', { ref: short(userId) })}</h2>
      <Action title={t('staff.member.sanction_title')} button={t('staff.member.sanction_button')} consequence={t('staff.member.sanction_consequence')} t={t} lang={lang}
        valid={kind !== '' && validEnd} invalidText={t('staff.member.sanction_incomplete')}
        run={(reason) => api.post(`/staff/users/${u}/sanctions`, { kind, reason, ...(ends ? { endsAt: ends.toISOString() } : {}), ...(fraud ? { fraud: true } : {}), ...(related ? { related } : {}) })}
        done={() => t('staff.member.sanction_done')}>
        <Choice legend={t('staff.member.kind')} name={`kind-${userId}`} value={kind} options={KINDS.map((k) => [k, t(`staff.sanction.${k}`)])} onChange={setKind} />
        {kind !== '' && kind !== 'warning' && kind !== 'listing_removal' && (
          <div className={styles.field}>
            <label htmlFor={`until-${userId}`}>{t('staff.member.until')}</label>
            <input id={`until-${userId}`} type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-describedby={`until-hint-${userId}`} />
            <p id={`until-hint-${userId}`} className={styles.hint}>{t('staff.member.until_hint')}</p>
          </div>
        )}
        <div className={styles.choice}><div>
          <input id={`fraud-${userId}`} type="checkbox" checked={fraud} onChange={(e) => setFraud(e.target.checked)} />
          <label htmlFor={`fraud-${userId}`}>{t('staff.member.fraud')}</label>
        </div></div>
      </Action>
      <Action title={t('staff.member.revoke_title')} button={t('staff.member.revoke_button')} consequence={t('staff.member.four_eyes_consequence')} t={t} lang={lang}
        run={(reason) => api.post(`/staff/users/${u}/kyc/revoke`, { reason })} done={() => t('staff.member.proposed')} />
      <Action title={t('staff.member.blacklist_title')} button={t('staff.member.blacklist_button')} consequence={t('staff.member.four_eyes_consequence')} t={t} lang={lang}
        run={(reason) => api.post('/staff/blacklist', { userId, source: 'fraud_decision', reason })} done={() => t('staff.member.proposed')} />
      <Action title={t('staff.member.conflict_title')} button={t('staff.member.conflict_button')} consequence={t('staff.member.conflict_consequence')} t={t} lang={lang}
        run={(reason) => api.post('/staff/conflicts', { userId, reason })} done={() => t('staff.member.conflict_done')} />
    </section>
  );
}
