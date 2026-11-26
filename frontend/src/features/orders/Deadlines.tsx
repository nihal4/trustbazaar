// Every deadline that applies to the order, each as a time and a countdown (docs/design/08_frontend.pdf section
// 7.5 (2); NFR-USE-08; U8-06): the payment window, the fulfilment deadline, the agreed meetup time, the end of the
// dispute window and the automatic release (or, for a game account, the end of the protection period). The dispute's
// own deadlines are on the dispute tab (U8-09).
import { Moment } from '../../shared/Moment';
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
  // every deadline is a ruled cell, label over value (in the Meetup handover it is the first row of its grid; otherwise the head of the rail)
  return (
    <section aria-labelledby="deadlines-title" className={styles.deadlineWrap}>
      <h2 id="deadlines-title" className={styles.srOnly}>{t('deadlines.title')}</h2>
      <dl className={styles.deadlineGrid}>
        {list.map((d) => (
          <div key={d.key} className={soon(d) ? styles.urgent : undefined}>
            <dt>{t(d.key)}</dt>
            <dd><Moment at={d.at} now={now} t={t} lang={lang} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
