// The rows of actions on a page (U11-15): a button or a link that is a full-width ruled row with an arrow at its end, as the actions in the rail of the order page. `ActionList` is the ruled
// list that holds them; an `ActionCell` in it is one row of the list (one to a line, hairlines between), and an `ActionCell` outside a list is a ruled cell of its own (a button that opens a popup).
//   default  an ordinary action     primary  the action to take now (vermilion rule and a light wash; a row of a list only)     quiet  a low-key action (muted)
// `as` renders a link (<ActionCell as={Link} to="/disputes/1">), `compact` is the 44 px row for a tight panel.
import { createContext, useContext, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './actionList.module.css';

const InList = createContext(false);

export function ActionList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <InList.Provider value>
      <div className={cx(styles.list, className)}>{children}</div>
    </InList.Provider>
  );
}

type OwnProps<T extends ElementType> = { as?: T; variant?: 'default' | 'primary' | 'quiet'; compact?: boolean; children?: ReactNode };

export function ActionCell<T extends ElementType = 'button'>({
  as,
  variant = 'default',
  compact,
  className,
  children,
  ...rest
}: OwnProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof OwnProps<T>> & { className?: string }) {
  const inList = useContext(InList);
  const Tag: ElementType = as ?? 'button';
  const action = (
    <Tag
      {...(Tag === 'button' ? { type: 'button' } : {})}
      {...rest}
      className={cx(inList ? styles.row : styles.cell, inList && variant !== 'default' && styles[variant], compact && styles.compact, className)}
    >
      {children}
    </Tag>
  );
  return inList ? <div className={styles.item}>{action}</div> : action;
}
