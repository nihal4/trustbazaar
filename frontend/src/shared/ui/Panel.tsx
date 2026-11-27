// Panel, Section and Card (U11-05): the ruled surfaces of a page.
//   Panel    a block of a page. section: a rule on top (the usual block); boxed: ruled on all sides (an item in a list); emphasis: a 2 px vermilion rule on top (money, the order's rail).
//   Section  a heading and what belongs under it, with an optional action beside the heading; it has no surface of its own.
//   Card     a boxed panel that can be a link (a listing in a grid): it lifts its rule on hover and has a picture slot on top.
// None of them knows what is inside: the page gives the content and the heading words.
import { useId, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './panel.module.css';

export type PanelVariant = 'section' | 'boxed' | 'emphasis';
type HeadingLevel = 2 | 3 | 4;

interface PanelOwn<T extends ElementType> {
  as?: T;
  variant?: PanelVariant;
  /** a heading for the panel; the panel is labelled by it */
  title?: ReactNode;
  headingLevel?: HeadingLevel;
  children?: ReactNode;
  className?: string;
}

export type PanelProps<T extends ElementType = 'section'> = PanelOwn<T> & Omit<ComponentPropsWithoutRef<T>, keyof PanelOwn<T>>;

export function Panel<T extends ElementType = 'section'>({ as, variant = 'section', title, headingLevel = 2, className, children, ...rest }: PanelProps<T>) {
  const Tag: ElementType = as ?? 'section';
  const heading = useId();
  const Heading = `h${headingLevel}` as ElementType;
  return (
    <Tag {...rest} aria-labelledby={title ? heading : undefined} className={cx(styles.panel, styles[variant], className)}>
      {title && (
        <Heading id={heading} className={styles.title}>
          {title}
        </Heading>
      )}
      {children}
    </Tag>
  );
}

interface SectionProps {
  title: ReactNode;
  headingLevel?: HeadingLevel;
  /** what sits at the end of the heading row: a link, a count, a button */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Section({ title, headingLevel = 2, action, className, children }: SectionProps) {
  const heading = useId();
  const Heading = `h${headingLevel}` as ElementType;
  return (
    <section aria-labelledby={heading} className={cx(styles.sectionBlock, className)}>
      <div className={styles.sectionHead}>
        <Heading id={heading} className={styles.title}>
          {title}
        </Heading>
        {action}
      </div>
      {children}
    </section>
  );
}

type CardProps<T extends ElementType> = { as?: T; media?: ReactNode; className?: string; children?: ReactNode } & Omit<
  ComponentPropsWithoutRef<T>,
  'as' | 'media' | 'className' | 'children'
>;

export function Card<T extends ElementType = 'article'>({ as, media, className, children, ...rest }: CardProps<T>) {
  const Tag: ElementType = as ?? 'article';
  const interactive = Tag !== 'article' && Tag !== 'div' && Tag !== 'li';
  return (
    <Tag {...rest} className={cx(styles.card, interactive && styles.cardLink, className)}>
      {media && <div className={styles.media}>{media}</div>}
      <div className={styles.cardBody}>{children}</div>
    </Tag>
  );
}
