// Tabs as a row of links or buttons (U11-05): the sections of one place (the account's profile, security, notifications). They are links between routes, not panels: each section has its
// own address and the back button works. The current one is marked with aria-current and has a vermilion rule under it. On a narrow screen the row scrolls sideways on its own, never the
// page, and the current tab is brought into view (again once the web font has arrived, because the widths change then).
//   <Tabs label="Account" watch={pathname}><Tab as={NavLink} to="/account" end>Profile</Tab>...</Tabs>
import { useEffect, useRef, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react';
import { cx } from './cx';
import styles from './tabs.module.css';

export function Tabs({
  label,
  watch,
  children,
  className,
}: {
  label: string;
  /** changes when the current tab does, so the row scrolls to it */ watch?: unknown;
  children: ReactNode;
  className?: string;
}) {
  const row = useRef<HTMLElement>(null);
  useEffect(() => {
    const show = () => {
      const nav = row.current;
      const current = nav?.querySelector<HTMLElement>('[aria-current]');
      if (nav && current) nav.scrollLeft = Math.max(0, current.offsetLeft - nav.offsetLeft - 16);
    };
    show();
    void document.fonts?.ready.then(show);
  }, [watch]);
  return (
    <nav ref={row} aria-label={label} className={cx(styles.tabs, className)}>
      <ul>{children}</ul>
    </nav>
  );
}

type TabProps<T extends ElementType> = { as?: T; className?: string; children?: ReactNode } & Omit<
  ComponentPropsWithoutRef<T>,
  'as' | 'className' | 'children'
>;

export function Tab<T extends ElementType = 'a'>({ as, className, children, ...rest }: TabProps<T>) {
  const Tag: ElementType = as ?? 'a';
  return (
    <li>
      <Tag {...rest} className={cx(styles.tab, className)}>
        {children}
      </Tag>
    </li>
  );
}
