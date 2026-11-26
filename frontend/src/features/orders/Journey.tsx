// The journey of a paid order (U10-23): the steps from payment to the money leaving, for the way the item is getting there, with the step the order is
// on marked and one sentence of what to do in it. Two journeys: meeting the seller (agree a place, meet and check, the handover code, release) and a courier
// (the seller sends it, it is on the way with the courier named, it arrives and is opened on video, release). It reads the handover and the shipments the
// order page already has; the steps below it (the handover form, the shipments) are where the actions are.
import type { T } from '../../shared/language/catalogue';
import type { HandoverView, OrderView, Shipment } from './model';
import styles from './orders.module.css';
import { Tick } from '../../shared/icons';

type State = 'done' | 'now' | 'next';
interface Step { key: string; state: State }

/** The courier's name as the buyer knows it; the test courier says so. */
export const courierName = (provider: string, t: T): string => (provider === 'pathao' ? 'Pathao' : provider === 'steadfast' ? 'Steadfast' : t('journey.test_courier'));

const rank = (steps: Step[]): Step[] => {
  const at = steps.findIndex((s) => s.state === 'now');
  return steps.map((s, i) => ({ ...s, state: at === -1 ? s.state : i < at ? 'done' : i === at ? 'now' : 'next' }));
};

export function journeyOf(o: OrderView, h: HandoverView | null, shipments: Shipment[]): { kind: 'pickup' | 'courier'; steps: Step[] } | null {
  if (o.status === 'awaiting_payment' || o.status === 'cancelled') return null;
  const closed = o.status === 'closed';
  if (o.fulfilment === 'courier') {
    const s = shipments.find((x) => x.direction === 'forward') ?? null;
    const sent = !!s && ['booked', 'picked_up', 'in_transit', 'delivered'].includes(s.status);
    const moving = !!s && ['picked_up', 'in_transit', 'delivered'].includes(s.status);
    const arrived = !!s && s.status === 'delivered';
    const pick = (done: boolean, now: boolean): State => (done ? 'done' : now ? 'now' : 'next');
    const steps: Step[] = [
      { key: 'send', state: pick(sent || closed, !sent) },
      { key: 'road', state: pick(arrived || closed, sent && !arrived) },
      { key: 'open', state: pick(closed, arrived) },
      { key: 'release', state: pick(closed, false) },
    ];
    return { kind: 'courier', steps: closed ? steps.map((x) => ({ ...x, state: 'done' as State })) : rank(moving || arrived || sent ? steps : [{ ...steps[0], state: 'now' }, ...steps.slice(1)]) };
  }
  const agreed = h?.status === 'agreed' || h?.status === 'completed';
  const handed = h?.status === 'completed' || o.deliveryEventAt !== null || closed;
  const steps: Step[] = [
    { key: 'agree', state: agreed || handed ? 'done' : 'now' },
    { key: 'meet', state: handed ? 'done' : agreed ? 'now' : 'next' },
    { key: 'code', state: handed ? 'done' : 'next' },
    { key: 'release', state: closed ? 'done' : handed ? 'now' : 'next' },
  ];
  return { kind: 'pickup', steps };
}

export function Journey({ o, h, shipments, t }: { o: OrderView; h: HandoverView | null; shipments: Shipment[]; t: T }) {
  const j = journeyOf(o, h, shipments);
  if (!j) return null;
  const s = shipments.find((x) => x.direction === 'forward');
  const who = s ? courierName(s.provider, t) : t('journey.courier');
  const role = o.role;
  return (
    <section aria-labelledby="journey-title" className={styles.journey}>
      <h2 id="journey-title">{t(j.kind === 'courier' ? 'journey.title_courier' : 'journey.title_pickup')}</h2>
      <ol className={styles.journeyList}>
        {j.steps.map((st, i) => (
          <li key={st.key} className={st.state === 'done' ? styles.flowDone : st.state === 'now' ? styles.flowNow : styles.flowNext} aria-current={st.state === 'now' ? 'step' : undefined}>
            <h3>
              <span className={styles.flowNo} aria-hidden="true">{st.state === 'done' ? <Tick /> : i + 1}</span>
              {t(`journey.${j.kind}.${st.key}`, { courier: who })}
              <span className={styles.srOnly}> {t(`journey.state.${st.state}`)}</span>
            </h3>
            {st.state === 'now' && <p className={styles.journeyDo}>{t(`journey.${j.kind}.${st.key}.${role}`, { courier: who })}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
