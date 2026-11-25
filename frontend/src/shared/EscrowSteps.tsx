// The three steps of an order's money, in order (docs/design/10_visual_v3.md, section 7): paid in, held, paid out. One
// component for every screen that shows them (the home page, the listing page, checkout and the order page); the caller
// gives the labels, the current step and the classes of its own place. A step before the current one is done, the current
// one is marked, the rest are waiting. It is a plain ordered list, so a screen reader reads the steps in order.
import type { ReactNode } from 'react';

export type EscrowStep = 'in' | 'held' | 'out';
const ORDER: EscrowStep[] = ['in', 'held', 'out'];

export interface EscrowStepsProps {
  /** the three labels, in order: paid in, held, paid out */
  labels: [ReactNode, ReactNode, ReactNode];
  /** the step the money is at */
  current: EscrowStep;
  /** the classes of the list and of its done and current items, from the screen's own stylesheet */
  classes: { list: string; done: string; current: string };
}

export function EscrowSteps({ labels, current, classes }: EscrowStepsProps) {
  const at = ORDER.indexOf(current);
  return (
    <ol className={classes.list}>
      {labels.map((label, i) => (
        <li key={ORDER[i]} className={i < at ? classes.done : i === at ? classes.current : undefined} aria-current={i === at ? 'step' : undefined}>{label}</li>
      ))}
    </ol>
  );
}
