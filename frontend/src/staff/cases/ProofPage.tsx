// An ownership proof, /staff/ownership-proofs/:id (FR-GAM-03, FR-GAM-04; Unit 5 section 3; U8-10): the game, platform
// and player ID the seller claims, the screenshot by a signed link (CP-31), the operator's own check in the game,
// and the decision: approving publishes the listing, rejecting returns it to the seller with the reason.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '../../lib/time.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { queueKey } from '../model';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Action, CaseFrame, Choice, Facts, short, staffError } from './common';
import { useQueued } from './queued';
import { Button } from '../../shared/ui';

type Live = 'matched' | 'not_matched' | 'not_available';

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useStaffT();
  const api = useApi();
  const queryClient = useQueryClient();
  const q = useQueued('ownership_proofs', id);
  const [decision, setDecision] = useState<'approve' | 'reject' | ''>('');
  const [live, setLive] = useState<Live | ''>('');
  const [shot, setShot] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = q.item;
  const s = (k: string) => (p && typeof p[k] === 'string' ? (p[k] as string) : '');
  const showShot = async () => {
    setError(null);
    try {
      setShot((await api.get(`/staff/game/ownership-proofs/${encodeURIComponent(id)}/screenshot`)) as typeof shot);
    } catch (e) {
      setError(staffError(e, t, lang));
    }
  };
  return (
    <CaseFrame title={t('staff.proof.title', { ref: short(id) })} back="/staff/queues/ownership_proofs" t={t}>
      {q.isPending && <p role="status">{t('shell.loading')}</p>}
      {q.isError && <FormMessage kind="error">{staffError(q.error, t, lang)}</FormMessage>}
      {q.isSuccess && !p && <FormMessage kind="info">{t('staff.case.not_open')}</FormMessage>}
      {p && (
        <>
          <section className={styles.panel} aria-labelledby="proof-facts">
            <h2 id="proof-facts">{t('staff.proof.facts')}</h2>
            <Facts
              rows={[
                [t('staff.proof.game'), s('game')],
                [t('staff.proof.platform'), s('platform')],
                [t('staff.proof.player'), s('playerId')],
                [t('staff.proof.submitted'), formatDateTime(Date.parse(p.since), lang)],
                [t('staff.proof.code_expires'), s('codeExpiresAt') ? formatDateTime(Date.parse(s('codeExpiresAt')), lang) : null],
                [
                  t('staff.proof.listing'),
                  <Link key="l" to={`/staff/listings/${encodeURIComponent(s('listingId'))}`}>
                    {t('staff.report.open_listing', { ref: short(s('listingId')) })}
                  </Link>,
                ],
              ]}
            />
            {error && <FormMessage kind="error">{error}</FormMessage>}
            {shot ? (
              <p>
                <a href={shot.url} target="_blank" rel="noopener noreferrer">
                  <img className={styles.proof} src={shot.url} alt={t('staff.proof.screenshot')} />
                </a>
              </p>
            ) : (
              <Button variant="secondary" type="button" onClick={() => void showShot()}>
                {t('staff.proof.show')}
              </Button>
            )}
            <p className={styles.hint}>{t('staff.case.links_expire')}</p>
          </section>
          <Action
            title={t('staff.proof.review_title')}
            button={t('staff.proof.review_button')}
            t={t}
            lang={lang}
            consequence={t(decision === 'reject' ? 'staff.proof.reject_consequence' : 'staff.proof.approve_consequence')}
            valid={decision !== '' && live !== '' && !(decision === 'approve' && live === 'not_matched')}
            invalidText={decision === 'approve' && live === 'not_matched' ? t('staff.refusal.live-check-not-matched') : t('staff.proof.incomplete')}
            run={(reason) => api.post(`/staff/game/ownership-proofs/${encodeURIComponent(id)}/review`, { decision, liveCheck: live, reason })}
            done={(r) => t((r as { status: string }).status === 'approved' ? 'staff.proof.approved' : 'staff.proof.rejected')}
            onDone={() => void queryClient.invalidateQueries({ queryKey: queueKey('ownership_proofs') })}
          >
            <Choice
              legend={t('staff.proof.live')}
              name="proof-live"
              value={live}
              options={[
                ['matched', t('staff.proof.live.matched')],
                ['not_matched', t('staff.proof.live.not_matched')],
                ['not_available', t('staff.proof.live.not_available')],
              ]}
              onChange={setLive}
            />
            <Choice
              legend={t('staff.proof.decision')}
              name="proof-decision"
              value={decision}
              options={[
                ['approve', t('staff.proof.approve')],
                ['reject', t('staff.proof.reject')],
              ]}
              onChange={setDecision}
            />
          </Action>
        </>
      )}
    </CaseFrame>
  );
}
