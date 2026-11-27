// The details of a listing as a list of facts: category, condition, how it can be handed over, the district and, for a phone or a laptop, the device
// identifier's last digits.
import type { Lang } from '../../shared/language/lang';
import { type ListingView } from './model';
import styles from './listings.module.css';
import { T } from './listingShared';

export function Details({ l, t, lang }: { l: ListingView; t: T; lang: Lang }) {
  return (
    <section aria-labelledby="details-title">
      <h2 id="details-title">{t('listing.details')}</h2>
      <dl className={styles.details}>
        <div>
          <dt>{t('listing.category')}</dt>
          <dd>{lang === 'bn' ? l.category.nameBn : l.category.nameEn}</dd>
        </div>
        {l.condition && (
          <div>
            <dt>{t('listing.condition')}</dt>
            <dd>{t(`listing.condition.${l.condition}`)}</dd>
          </div>
        )}
        {l.fulfilmentOptions && (
          <div>
            <dt>{t('listing.fulfilment')}</dt>
            <dd>{t(`listing.fulfilment.${l.fulfilmentOptions}`)}</dd>
          </div>
        )}
        {l.district && (
          <div>
            <dt>{t('listing.district')}</dt>
            <dd>{l.district}</dd>
          </div>
        )}
        {l.serialLast4 && (
          <div>
            <dt>{t('listing.serial')}</dt>
            <dd>•••• {l.serialLast4}</dd>
          </div>
        )}
        {l.noVisibleDefects !== null && (
          <div className={styles.wide}>
            <dd>{l.noVisibleDefects ? t('listing.no_visible_defects') : t('listing.defects_in_photos')}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
