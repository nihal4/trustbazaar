// A listing, /staff/listings/:id (FR-LST-11, FR-LST-12; section 7.9; U8-10): the listing as its seller sees it, read
// through the console (Decisions log, U8-10). A listing held for review is approved or returned to its seller with a
// reason; a game account is reviewed through its ownership proof instead. Any listing not yet removed can be removed
// for a policy breach, which also cancels an open auction on it.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '../../lib/money.js';
import { useApi } from '../../shared/api';
import { FormMessage } from '../../shared/form';
import { queueKey } from '../model';
import { useStaffT } from '../text';
import styles from '../staff.module.css';
import { Action, CaseFrame, Choice, Facts, short, staffError } from './common';

interface StaffListing {
  id: string;
  itemKind: 'physical' | 'game_account';
  saleFormat: string;
  status: string;
  title: string;
  description: string;
  condition: string | null;
  category: { nameEn: string; nameBn: string };
  price: string | null;
  district: string | null;
  photos: { id: string; url: string; thumbUrl: string; showsDefects: boolean }[];
  seller: { id: string; displayName: string; verified: boolean };
  auction: { price?: string; bidCount?: number; endsAt?: string } | null;
}
const listingKey = (id: string) => ['staff', 'listing', id] as const;

export function Component() {
  const { id = '' } = useParams();
  const { t, lang } = useStaffT();
  const api = useApi();
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<'approve' | 'return' | ''>('');
  const l = useQuery({
    queryKey: listingKey(id),
    queryFn: ({ signal }) => api.get(`/staff/listings/${encodeURIComponent(id)}`, { signal }) as Promise<StaffListing>,
    staleTime: 0,
    retry: false,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: listingKey(id) });
    void queryClient.invalidateQueries({ queryKey: queueKey('listings_review') });
  };
  const v = l.data;
  return (
    <CaseFrame title={t('staff.listing.title', { ref: short(id) })} back="/staff/queues/listings_review" t={t}>
      {l.isPending && <p role="status">{t('shell.loading')}</p>}
      {l.isError && <FormMessage kind="error">{staffError(l.error, t, lang)}</FormMessage>}
      {v && (
        <>
          <section className={styles.panel} aria-labelledby="listing-facts">
            <h2 id="listing-facts">{v.title}</h2>
            <Facts
              rows={[
                [t('staff.listing.status'), v.status],
                [t('staff.listing.kind'), t(`staff.listing.kind.${v.itemKind}`)],
                [t('staff.listing.category'), lang === 'bn' ? v.category.nameBn : v.category.nameEn],
                [t('staff.listing.price'), v.price ? formatMoney(BigInt(v.price), lang) : v.auction?.price ? formatMoney(BigInt(v.auction.price), lang) : null],
                [t('staff.listing.condition'), v.condition],
                [t('staff.listing.district'), v.district],
                [t('staff.listing.seller'), v.seller.displayName + (v.seller.verified ? ' · ' + t('staff.case.verified') : '') + ` (${short(v.seller.id)})`],
              ]}
            />
            <h3>{t('staff.listing.description')}</h3>
            <p className={styles.text}>{v.description}</p>
            {v.photos.length > 0 && (
              <ul className={styles.thumbs} aria-label={t('staff.listing.photos')}>
                {v.photos.map((p, i) => (
                  <li key={p.id}>
                    <a href={p.url} target="_blank" rel="noopener noreferrer">
                      <img src={p.thumbUrl} alt={t('staff.listing.photo', { n: String(i + 1) })} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {v.status === 'pending_review' && v.itemKind === 'game_account' && (
            <FormMessage kind="info">
              {t('staff.listing.use_proof')} <Link to="/staff/queues/ownership_proofs">{t('staff.queue.ownership_proofs')}</Link>
            </FormMessage>
          )}
          {v.status === 'pending_review' && v.itemKind === 'physical' && (
            <Action
              title={t('staff.listing.review_title')}
              button={t('staff.listing.review_button')}
              t={t}
              lang={lang}
              consequence={t(decision === 'return' ? 'staff.listing.return_consequence' : 'staff.listing.approve_consequence')}
              valid={decision !== ''}
              invalidText={t('staff.report.choose')}
              run={(reason) => api.post(`/staff/listings/${encodeURIComponent(id)}/review`, { decision, reason })}
              done={(r) => t((r as { status: string }).status === 'active' ? 'staff.listing.approved' : 'staff.listing.returned')}
              onDone={refresh}
            >
              <Choice
                legend={t('staff.listing.decision')}
                name="listing-decision"
                value={decision}
                options={[
                  ['approve', t('staff.listing.approve')],
                  ['return', t('staff.listing.return')],
                ]}
                onChange={setDecision}
              />
            </Action>
          )}
          {v.status !== 'removed' && (
            <Action
              title={t('staff.listing.remove_title')}
              button={t('staff.listing.remove_button')}
              consequence={t('staff.listing.remove_consequence')}
              t={t}
              lang={lang}
              run={(reason) => api.post(`/staff/listings/${encodeURIComponent(id)}/remove`, { reason })}
              done={() => t('staff.listing.removed')}
              onDone={refresh}
            />
          )}
        </>
      )}
    </CaseFrame>
  );
}
