// A tag and a count (U11-04). A tag names a state (draft, in escrow, verified, disputed); its meaning is in its words, the tone only supports it. A count is the number on a badge
// (unread messages), capped so it never grows wider than a cell.
import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './tag.module.css';

export type TagTone = 'neutral' | 'hot' | 'ok' | 'error';

export function Tag({ tone = 'neutral', className, children }: { tone?: TagTone; className?: string; children: ReactNode }) {
  return <span className={cx(styles.tag, styles[tone], className)}>{children}</span>;
}

export function Count({ value, max = 99, className }: { value: number; max?: number; className?: string }) {
  if (value <= 0) return null;
  return <span className={cx(styles.count, className)}>{value > max ? `${max}+` : value}</span>;
}
