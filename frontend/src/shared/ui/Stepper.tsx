// A stepper (U11-05): the stages of something in order, each done, current or still to come. The steps and their words come in as data (a view model decides them for the buyer, the
// seller or any other role; see features/orders/progress.ts); this draws them. Horizontal when there is room and vertical when there is not, or always vertical if asked. It is an
// ordered list: a screen reader reads the steps in order, the current one is marked, and `stateWords` say each state in words for anyone who cannot tell the marks apart.
import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './stepper.module.css';

export type StepState = 'done' | 'current' | 'next';

export interface StepperStep {
  key: string;
  label: ReactNode;
  /** a line under the label: a date, a name */
  note?: ReactNode;
  state: StepState;
}

interface StepperProps {
  steps: StepperStep[];
  /** a name for the list, such as "Order progress" */
  label?: string;
  stateWords?: Record<StepState, string>;
  orientation?: 'auto' | 'vertical';
  className?: string;
}

export function Stepper({ steps, label, stateWords, orientation = 'auto', className }: StepperProps) {
  return (
    // role="list" is not redundant here: Safari and VoiceOver drop the list semantics of an <ol> whose bullets are removed (list-style: none)
    // eslint-disable-next-line jsx-a11y/no-redundant-roles
    <ol
      aria-label={label}
      role="list"
      className={cx(styles.steps, orientation === 'vertical' && styles.vertical, className)}
      style={{ '--steps': steps.length } as React.CSSProperties}
    >
      {steps.map((s) => (
        <li key={s.key} className={cx(styles.step, styles[s.state])} aria-current={s.state === 'current' ? 'step' : undefined}>
          <b>{s.label}</b>
          {s.note && <span className={styles.note}>{s.note}</span>}
          {stateWords && <span className={styles.sr}> {stateWords[s.state]}</span>}
        </li>
      ))}
    </ol>
  );
}
