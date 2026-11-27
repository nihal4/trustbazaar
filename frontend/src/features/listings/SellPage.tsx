// The listing editor, /sell/new and /sell/:id (docs/design/08_frontend.pdf section 7.3; FR-LST-01 to FR-LST-12,
// FR-MON-01; IF-SW-08; U8-14). A draft is created once (Idempotency-Key), then edited; photos are uploaded one by
// one with their progress, up to CP-33; the area is chosen on Unit 4's list, or found from the device's position
// after a button press with the list as the fallback. Before publishing the screen shows the commission that will
// be deducted from the payout (CP-25, from GET /me/selling-terms) and FR-LST-07's limit; an auction's terms are
// given at publication and never change. A listing sent to review says so. After publication only the fields the
// server still allows are offered, and clarifications can always be added. A game account (U8-07; Unit 5 section 3)
// has no condition, delivery or area and sells one; its game details and the ownership proof are on GameListing.
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toLocalDigits } from '../../lib/money.js';

import { useApi } from '../../shared/api';
import { signInPath } from '../../shared/document';
import { errorText } from '../../shared/errors';
import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import { useT } from '../../shared/language/Language';

import { useMe } from '../../shared/me';
import { isApiError } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { GameListing } from './GameListing';
import { type EditableListing, type SellingTerms } from './sell';
import en from '../../messages/en/sell.json';
import bn from '../../messages/bn/sell.json';
import styles from './sell.module.css';

import { Photos } from './SellPhotos';
import { listingKey } from './sellShared';
import { Publish } from './SellPublish';
import { Clarifications } from './SellClarifications';
import { DetailsForm } from './SellDetails';

const CATALOGUES = { en, bn };

export function Component() {
  const { id } = useParams();
  const { t, lang } = useT(CATALOGUES);
  const api = useApi();
  const me = useMe();
  const navigate = useNavigate();
  useEffect(() => {
    if (me.isError) void navigate(signInPath(id ? `/sell/${id}` : '/sell/new'), { replace: true });
  }, [me.isError, navigate, id]);
  const terms = useQuery({
    queryKey: ['me', 'selling-terms'],
    queryFn: ({ signal }) => api.get('/me/selling-terms', { signal }) as Promise<SellingTerms>,
    staleTime: FRESHNESS.account,
    retry: false,
    enabled: me.isSuccess,
  });
  const listing = useQuery({
    queryKey: listingKey(id ?? ''),
    queryFn: ({ signal }) => api.get(`/listings/${encodeURIComponent(id ?? '')}`, { signal }) as Promise<EditableListing>,
    staleTime: FRESHNESS.account,
    retry: false,
    enabled: me.isSuccess && id !== undefined,
  });

  if (me.isPending || me.isError) return <p role="status">{t('shell.loading')}</p>;
  if (terms.isError) {
    return (
      <div className={styles.page}>
        <h1>{t('sell.title_new')}</h1>
        <FormMessage kind="info">{isApiError(terms.error, 403) ? t('sell.verify') : errorText(terms.error, t, lang)}</FormMessage>
      </div>
    );
  }
  if (!terms.data || (id && listing.isPending)) return <p role="status">{t('shell.loading')}</p>;
  if (id && (listing.isError || !listing.data?.own)) {
    return (
      <div className={styles.page}>
        <h1>{t('sell.not_found')}</h1>
      </div>
    );
  }
  const l = listing.data ?? null;
  const drafting = !l || l.status === 'draft';
  return (
    <div className={drafting ? `${styles.page} ${styles.withSteps}` : styles.page}>
      <h1 className={styles.title}>{l ? t('sell.title_edit', { title: l.title }) : t('sell.title_new')}</h1>
      {drafting && <SellSteps l={l} minPhotos={terms.data.photos.min} t={t} />}
      <div className={styles.main}>
        {l && (
          <p>
            <strong>{t(`sell.status.${l.status}`)}</strong>
            {l.status !== 'draft' && (
              <>
                {' '}
                · <Link to={`/listings/${encodeURIComponent(l.id)}`}>{t('sell.view_listing')}</Link>
              </>
            )}
          </p>
        )}
        <p className={styles.hint}>
          {t('sell.limits', {
            count: toLocalDigits(String(terms.data.activeListings.count), lang),
            limit: toLocalDigits(String(terms.data.activeListings.limit), lang),
          })}
        </p>
        {(!l || l.status === 'draft' || (l.status === 'active' && !l.locked && l.saleFormat === 'fixed_price')) && (
          <DetailsForm key={l?.own?.updatedAt ?? 'new'} l={l} terms={terms.data} t={t} lang={lang} />
        )}
        {l && l.itemKind === 'physical' && l.status === 'draft' && <Photos l={l} terms={terms.data} t={t} lang={lang} />}
        {l && l.itemKind === 'game_account' && (l.status === 'draft' || l.status === 'pending_review') && <GameListing l={l} t={t} lang={lang} />}
        {l && l.status === 'draft' && <Publish l={l} terms={terms.data} t={t} lang={lang} />}
        {l && l.status === 'pending_review' && (
          <FormMessage kind="info">{t(l.itemKind === 'game_account' ? 'sell.game.in_review' : 'sell.in_review')}</FormMessage>
        )}
        {l && l.status === 'active' && (l.locked || l.saleFormat === 'auction') && <p>{t('sell.locked_note')}</p>}
        {l && l.status === 'active' && <Clarifications l={l} t={t} lang={lang} />}
      </div>
    </div>
  );
}

/**
 * Where a new or draft listing stands (Daylight design, docs/design/10_visual.md, section 7.7): the item, then its
 * photos (or the game account's details), then publishing; each done, now or still to come, in words as well.
 */
export function sellStepsOf(
  l: EditableListing | null,
  minPhotos: number,
): { key: 'details' | 'photos' | 'game' | 'publish'; state: 'done' | 'current' | 'next' }[] {
  const game = l?.itemKind === 'game_account';
  const media = game ? 'game' : 'photos';
  const mediaDone = !!l && !game && l.photos.length >= minPhotos;
  return [
    { key: 'details', state: l ? 'done' : 'current' },
    { key: media, state: !l ? 'next' : mediaDone ? 'done' : 'current' },
    { key: 'publish', state: l && l.status !== 'draft' ? 'done' : mediaDone ? 'current' : 'next' },
  ];
}

function SellSteps({ l, minPhotos, t }: { l: EditableListing | null; minPhotos: number; t: T }) {
  return (
    <ol className={styles.steps} aria-label={t('sell.steps.label')}>
      {sellStepsOf(l, minPhotos).map((s) => (
        <li key={s.key} className={styles[s.state]} aria-current={s.state === 'current' ? 'step' : undefined}>
          <span className={styles.dot} aria-hidden="true" />
          <span>{t(`sell.steps.${s.key}`)}</span>
          <span className={styles.visuallyHidden}>{t(`sell.steps.state.${s.state}`)}</span>
        </li>
      ))}
    </ol>
  );
}
