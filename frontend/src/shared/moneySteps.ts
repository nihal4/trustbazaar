// The three steps of an order's money, in order (docs/design/10_visual_v3.md, section 7): paid in, held, paid out. One function for every screen that shows them (the home page,
// the checkout and the order page): the caller gives the labels and the step the money is at, and gets the steps for the Stepper. A step before the current one is done, the current
// one is marked, the rest are waiting; `current` 'done' marks all three as done and `null` none of them (an explanation of what will happen, before anything has).
import type { ReactNode } from 'react';
import { phaseOf } from './stepPhase';
import type { StepperStep } from './ui';

export type EscrowStep = 'in' | 'held' | 'out';
const ORDER: EscrowStep[] = ['in', 'held', 'out'];

export function moneySteps(labels: [ReactNode, ReactNode, ReactNode], current: EscrowStep | 'done' | null): StepperStep[] {
  let at = -1;
  if (current === 'done') at = ORDER.length;
  else if (current !== null) at = ORDER.indexOf(current);
  return labels.map((label, i) => ({ key: ORDER[i], label, state: phaseOf(i, at) }));
}
