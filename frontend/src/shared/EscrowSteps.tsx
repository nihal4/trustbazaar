// The three steps of an order's money, in order (docs/design/10_visual_v3.md, section 7): paid in, held, paid out. One component for every screen that
// shows them (the home page, the checkout and the order page); the caller gives the labels and the step the money is at. A step before the current
// one is done, the current one is marked, the rest are waiting; `current` 'done' marks all three as done and `null` none of them (an explanation of
// what will happen, before anything has). It is a plain ordered list, so a screen reader reads the steps in order; `stateWords` adds each step's state
// in words for screen readers, and `label` names the list.
import type { ReactNode } from 'react';
import styles from './escrowSteps.module.css';

export type EscrowStep = 'in' | 'held' | 'out';
const ORDER: EscrowStep[] = ['in', 'held', 'out'];

export interface EscrowStepsProps {
  /** the three labels, in order: paid in, held, paid out */
  labels: [ReactNode, ReactNode, ReactNode];
  /** the step the money is at; 'done' when all three are done, null when none has happened yet */
  current: EscrowStep | 'done' | null;
  /** the classes of the list and of its done and current items, from the screen's own stylesheet (default: the shared ball-and-line look) */
  classes?: { list: string; done: string; current: string };
  /** each state in words, for screen readers (and for anyone who cannot tell the marks apart) */
  stateWords?: { done: string; current: string; next: string };
  /** a name for the list, such as "Order progress" */
  label?: string;
}

export function EscrowSteps({
  labels,
  current,
  classes = { list: styles.list, done: styles.done, current: styles.current },
  stateWords,
  label,
}: EscrowStepsProps) {
  const at = current === 'done' ? ORDER.length : current === null ? -1 : ORDER.indexOf(current);
  return (
    <ol className={classes.list} aria-label={label} role="list">
      {labels.map((text, i) => {
        const state = i < at ? 'done' : i === at ? 'current' : 'next';
        return (
          <li
            key={ORDER[i]}
            className={state === 'done' ? classes.done : state === 'current' ? classes.current : undefined}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            {text}
            {stateWords && <span className={styles.sr}> {stateWords[state]}</span>}
          </li>
        );
      })}
    </ol>
  );
}
