// The meetup handover (docs/design/08_frontend.pdf section 7.5; Unit 4 section 3.1; FR-DLV-03 to FR-DLV-06; U8-06).
// The buyer's code is hidden behind "Show code", large and readable aloud digit by digit, with its instruction
// (confirm.share_handover_code). The seller enters it, told to hand over the item only after the buyer gives it, with
// the attempts left before the lock. Proposals: a suggested public point (with a map link) or a place of the parties'
// own (a name and an optional pin from the device's position, never a map link, shown with a safety notice; Decisions
// log, U4-03). Times are Dhaka time.

import { Panel } from '../../shared/ui';
import { DateCells } from '../../shared/Moment';

import { type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../shared/api';

import { FormMessage } from '../../shared/form';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';
import { FRESHNESS } from '../../shared/query';
import { handoverKey, type HandoverView, type OrderView } from './model';
import styles from './orders.module.css';
import { SellerCode } from './HandoverSellerCode';

import { Where } from './handoverShared';
import { Proposals } from './HandoverProposals';
import { BuyerCode } from './HandoverBuyerCode';

export function useHandover(o: OrderView) {
  const api = useApi();
  const enabled = o.fulfilment === 'self_pickup' && (o.status === 'paid' || o.status === 'closed');
  return useQuery({
    queryKey: handoverKey(o.id),
    queryFn: ({ signal }) => api.get(`/orders/${encodeURIComponent(o.id)}/handover`, { signal }) as Promise<HandoverView>,
    staleTime: FRESHNESS.money,
    // Unit 4 creates the handover from the order's paid event, a moment after the payment (outbox): right after paying it
    // may not exist yet (the outbox is read every 5 seconds, DV-67), so a 404 is asked again for about 15 seconds instead of
    // being shown as an error (U8-11).
    retry: (count, e) => problemName(e) === 'not-found' && count < HANDOVER_RETRIES,
    retryDelay: 1500,
    enabled,
  });
}

const HANDOVER_RETRIES = 10;

export function Handover({ o, h, t, lang, after, before }: { o: OrderView; h: HandoverView; t: T; lang: Lang; after?: ReactNode; before?: ReactNode }) {
  const open = h.status === 'arranging' || h.status === 'agreed';
  return (
    <Panel title={t('handover.title')} className={styles.panel}>
      {before}
      <dl className={styles.statusGrid}>
        <div>
          <dt>{t('handover.status_label')}</dt>
          <dd>{t(`handover.state.${h.status}`)}</dd>
        </div>
        {h.status === 'completed' && h.completedAt && (
          <div>
            <dt>{t('handover.done_label')}</dt>
            <dd>
              <DateCells at={Date.parse(h.completedAt)} t={t} lang={lang} label={false} />
            </dd>
          </div>
        )}
      </dl>
      {h.status === 'locked' && <FormMessage kind="error">{t('handover.locked')}</FormMessage>}
      {h.agreed && <Agreed a={h.agreed} t={t} lang={lang} />}
      {after}
      {open && h.role === 'buyer' && (h.code || h.deviceCheck) && <BuyerCode order={o.id} code={h.code} device={h.deviceCheck ?? null} t={t} lang={lang} />}
      {open && h.role === 'seller' && <SellerCode o={o} h={h} t={t} lang={lang} />}
      {open && <Proposals o={o} h={h} t={t} lang={lang} />}
    </Panel>
  );
}

function Agreed({ a, t, lang }: { a: NonNullable<HandoverView['agreed']>; t: T; lang: Lang }) {
  return (
    <dl className={styles.statusGrid}>
      <div>
        <dt>{t('handover.place_label')}</dt>
        <dd>
          <Where point={a.point} place={a.place} t={t} lang={lang} />
        </dd>
      </div>
      <div>
        <dt>{t('handover.when_label')}</dt>
        <dd>
          <DateCells at={Date.parse(a.meetAt)} t={t} lang={lang} label={false} />
        </dd>
      </div>
    </dl>
  );
}
