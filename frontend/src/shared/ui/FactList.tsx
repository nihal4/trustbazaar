// A list of facts, label over value, in ruled cells (U11-05): the quantity, the item and the total of an order; the dates of a deadline. One component whatever the number of facts;
// `columns` is the most it uses, and it uses fewer when there is not room (four on a desktop, two on a phone). The values keep their digits aligned.
import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './factList.module.css';

export interface Fact {
  label: ReactNode;
  value: ReactNode;
}

export function FactList({ items, columns = 4, className }: { items: Fact[]; columns?: 1 | 2 | 3 | 4; className?: string }) {
  return (
    <dl className={cx(styles.facts, styles[`cols${columns}`], className)}>
      {items.map((f, i) => (
        <div key={i} className={styles.fact}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
