// Every deadline that applies to the order, each as a time and a countdown (docs/design/08_frontend.pdf section
// 7.5 (2); NFR-USE-08; U8-06): the payment window, the fulfilment deadline, the agreed meetup time, the end of the
// dispute window and the automatic release (or, for a game account, the end of the protection period). The dispute's
// own deadlines are on the dispute tab (U8-09).
import { formatDeadline } from '../../lib/time.js';
import { useServerNow } from '../../shared/clock';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { ms, type HandoverView, type OrderView } from './model';
import styles from './orders.module.css';

export interface Deadline { key: string; at: number }

/** The deadlines that apply now, in time order. Pure, for the tests. */
export function deadlinesOf(o: OrderView, h: HandoverView | null): Deadline[] {
  const out: Deadline[] = [];
  const add = (key: string, at: number | null) => { if (at !== null) out.push({ key, at }); };
  if (o.status === 'awaiting_payment') add('deadline.payment', ms(o.paymentDueAt));
  if (o.status === 'paid' && o.escrow?.state === 'held') {
    if (o.deliveryEventAt === null) {
      add('deadline.fulfilment', ms(o.fulfilmentDueAt));
      if (h?.agreed && h.status === 'agreed') add('deadline.meetup', ms(h.agreed.meetAt));
    } else {
      add('deadline.dispute_window', ms(o.escrow.disputeWindowEndsAt));
      add(o.escrow.releasePolicy === 'game_protection' ? 'deadline.protection' : 'deadline.auto_release', ms(o.escrow.autoReleaseAt));
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function Deadlines({ o, h, t, lang }: { o: OrderView; h: HandoverView | null; t: T; lang: Lang }) {
  const now = useServerNow();
  const list = deadlinesOf(o, h);
  if (list.length === 0) return null;
  const soon = (d: Deadline) => d.at - now < 3_600_000 && d.at > now;
  // the next deadline stands out and the block stays in view in the rail; the others follow as ruled rows
  return (
    <section aria-labelledby="deadlines-title" className={styles.spot}>
      <h2 id="deadlines-title" className={styles.spotHead}>{t('deadlines.title')}</h2>
      <dl className={styles.deadlines}>
        {list.map((d) => (
          <div key={d.key} className={soon(d) ? styles.urgent : undefined}>
            <dt>{t(d.key)}</dt>
            <dd>{formatDeadline(d.at, now, lang)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
