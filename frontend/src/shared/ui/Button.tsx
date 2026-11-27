// The one button (U11-04; docs/design/11_inventory/canonical-set.html). Every button of the site is this, in one of four variants and two sizes; a page never styles a button of its own.
//   primary    the one main action of a view (vermilion rule and a light wash)
//   secondary  an ordinary action (ruled)
//   quiet      a small, low-key action (text only)
//   danger     an action that cannot be undone or ends something
//   link       an action that reads as a link (underlined, in the accent colour); `inline` sets it in a sentence, with no tap box of its own
// It is square and ruled like the rest of the grid, at least 44 px high (NFR-USE-06, WCAG 2.2 target size). `as` renders it as a link (<Button as={Link} to="/orders">) so that a link that
// looks like a button is a link for the keyboard and the screen reader, and a button that acts is a button.
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';
import { cx } from './cx';
import styles from './button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'link';
export type ButtonSize = 'md' | 'lg';

type OwnProps<T extends ElementType> = {
  as?: T;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** fills the width of its container (a button at the foot of a card or a phone sheet) */
  block?: boolean;
  /** a link-variant button set in a line of text */
  inline?: boolean;
  /** the action is running: the button is disabled and announced as busy */
  loading?: boolean;
  children?: ReactNode;
};

export type ButtonProps<T extends ElementType = 'button'> = OwnProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof OwnProps<T>>;

export function Button<T extends ElementType = 'button'>({
  as,
  variant = 'secondary',
  size = 'md',
  block,
  inline,
  loading,
  className,
  children,
  ...rest
}: ButtonProps<T> & { className?: string }) {
  const Tag: ElementType = as ?? 'button';
  const isButton = Tag === 'button';
  const disabled = isButton && (Boolean((rest as { disabled?: boolean }).disabled) || loading);
  return (
    <Tag
      // a button inside a form submits it only when it says so
      {...(isButton ? { type: (rest as { type?: string }).type ?? 'button' } : {})}
      {...rest}
      disabled={isButton ? disabled : undefined}
      aria-busy={loading || undefined}
      className={cx(styles.button, styles[variant], size === 'lg' && styles.lg, block && styles.block, inline && styles.inline, className)}
    >
      {children}
    </Tag>
  );
}

type IconButtonProps = Omit<ButtonProps<'button'>, 'children' | 'size' | 'block' | 'inline'> & {
  /** what it does, in words: an icon alone says nothing to a screen reader */
  label: string;
  children: ReactNode;
};

/** A square button with an icon only; the label is the accessible name. */
export function IconButton({ label, variant = 'secondary', className, children, ...rest }: IconButtonProps) {
  return (
    <Button {...rest} variant={variant} aria-label={label} className={cx(styles.icon, className)}>
      {children}
    </Button>
  );
}
