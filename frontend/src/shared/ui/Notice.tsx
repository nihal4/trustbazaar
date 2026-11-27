// A notice (U11-04): a message set into the page, square with a rule on its left. info says something; warning asks for care; error says what went wrong and is announced at once.
import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './notice.module.css';

export type NoticeTone = 'info' | 'warning' | 'error';

interface NoticeProps {
  tone?: NoticeTone;
  /** a short heading in bold */
  title?: string;
  className?: string;
  children?: ReactNode;
}

export function Notice({ tone = 'info', title, className, children }: NoticeProps) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx(styles.notice, styles[tone], className)}>
      {title && <strong className={styles.title}>{title}</strong>}
      {children}
    </div>
  );
}
