// A notice (U11-04): a message set into the page, square with a rule on its left. info says something; success says it worked; warning asks for care; error says what went wrong and is
// announced at once. `title` is a short bold line, or a heading when `headingLevel` is given (an error summary has one). A ref and a tabIndex go through, for a notice that takes focus.
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './notice.module.css';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: NoticeTone;
  title?: ReactNode;
  /** makes the title a heading of this level (and the notice named by it) */
  headingLevel?: 2 | 3 | 4;
  /** the id of the title, when a heading */
  titleId?: string;
  children?: ReactNode;
}

export const Notice = forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  { tone = 'info', title, headingLevel, titleId, className, children, ...rest },
  ref,
) {
  const Heading = headingLevel ? (`h${headingLevel}` as const) : 'strong';
  return (
    <div
      ref={ref}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-labelledby={headingLevel && title ? titleId : undefined}
      {...rest}
      className={cx(styles.notice, styles[tone], className)}
    >
      {title && (
        <Heading id={headingLevel ? titleId : undefined} className={styles.title}>
          {title}
        </Heading>
      )}
      {children}
    </div>
  );
});
