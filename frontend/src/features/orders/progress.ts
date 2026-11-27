// Where an order is, and what its three steps say (U11-04: the view model of the order's progress). The page does not decide this; it asks here and draws what comes back, so the
// buyer's and the seller's order, a cancelled one and a closed one all go through one tested function, and the Stepper primitive (shared/ui) only draws steps it is given.
import type { EscrowStep } from '../../shared/EscrowSteps';
import type { OrderView } from './model';

export type StepKey = 'payment' | 'handover' | 'done';
export type StepState = 'done' | 'current' | 'next';

const KEYS: readonly StepKey[] = ['payment', 'handover', 'done'];

/** 0 awaiting payment, 1 paid and waiting for the handover, 2 handed over, 3 closed */
function stageOf(o: OrderView): number {
  if (o.status === 'awaiting_payment') return 0;
  if (o.status === 'closed') return 3;
  return o.deliveryEventAt === null ? 1 : 2;
}

function stateAt(index: number, stage: number): StepState {
  if (index < stage) return 'done';
  if (index === stage) return 'current';
  return 'next';
}

/** Payment, the handover (or delivery) and the end, each done, current or still to come; a cancelled order has none. */
export function stepsOf(o: OrderView): { key: StepKey; state: StepState }[] {
  if (o.status === 'cancelled') return [];
  const stage = stageOf(o);
  return KEYS.map((key, i) => ({ key, state: stateAt(i, stage) }));
}

const MONEY_AT: Record<StepKey, EscrowStep> = { payment: 'in', handover: 'held', done: 'out' };

export interface OrderProgress {
  /** where the money is: paid in, held, paid out; 'done' when all three are; null for an order with no steps (cancelled) */
  current: EscrowStep | 'done' | null;
  /** the catalogue keys of the three labels, in the buyer's words ("Payment complete", "Money on hold", "Product confirmed") */
  labels: [string, string, string];
}

export function orderProgress(o: OrderView): OrderProgress {
  const steps = stepsOf(o);
  const now = steps.find((s) => s.state === 'current');
  let current: OrderProgress['current'] = 'done';
  if (steps.length === 0) current = null;
  else if (now) current = MONEY_AT[now.key];
  const paid = steps.find((s) => s.key === 'payment')?.state === 'done';
  return { current, labels: [paid ? 'order.steps.payment_done' : 'order.steps.payment', 'order.steps.handover_held', 'order.steps.done'] };
}
