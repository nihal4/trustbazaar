// The game-account side of a dispute: the proof screenshot, the takeover record and who had access to the credentials.
import { formatDateTime } from '../../lib/time.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import styles from '../staff.module.css';
import { Facts } from './common';
import { CaseFile } from './disputeTypes';

export function GameEvidence({ g, t, lang }: { g: NonNullable<CaseFile['game']>; t: T; lang: Lang }) {
  const at = (iso: string) => formatDateTime(Date.parse(iso), lang);
  return (
    <section className={styles.panel} aria-labelledby="dispute-game">
      <h2 id="dispute-game">{t('staff.dispute.game')}</h2>
      <p className={styles.hint}>{t('staff.dispute.game_no_credentials')}</p>
      {g.details && (
        <Facts
          rows={Object.entries(g.details)
            .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
            .map(([k, v]) => [k, String(v)])}
        />
      )}
      {g.proof?.screenshot && (
        <p>
          <a className={styles.openLink} href={g.proof.screenshot.url} target="_blank" rel="noopener noreferrer">
            {t('staff.dispute.proof_screenshot')}
          </a>
        </p>
      )}
      <h3>{t('staff.dispute.takeover')}</h3>
      <ul className={styles.items}>
        {g.confirmations.map((c) => (
          <li key={c.step}>
            {c.step} · {at(c.at)}
          </li>
        ))}
      </ul>
      <h3>{t('staff.dispute.access')}</h3>
      <ul className={styles.items}>
        {g.accessLog.map((a, i) => (
          <li key={i}>
            {at(a.at)} · {t(`staff.party.${a.party}`)} · {a.network ?? '—'}
          </li>
        ))}
      </ul>
    </section>
  );
}
