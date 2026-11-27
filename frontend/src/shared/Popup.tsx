// A popup over a blurred page (U10-23): a native <dialog> in the sheet look of the payment sheet: focus moves in, Escape and a click on the blur close it,
// focus returns to the opener. The content is the caller's (a form to fill in); the caller owns the buttons.
import { useEffect, useRef, type ReactNode } from 'react';
import { usePendingStepUp } from './stepUp';
import styles from './popup.module.css';

export function Popup({
  id,
  title,
  closeLabel,
  busy = false,
  decorativeClose = false,
  describedBy,
  isStepUp = false,
  wide = false,
  onClose,
  children,
}: {
  id: string;
  title: string;
  closeLabel: string;
  busy?: boolean;
  decorativeClose?: boolean;
  describedBy?: string;
  isStepUp?: boolean;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  // a popup never stands under another: while the step-up code is asked, every other popup is out of sight (and keeps what was typed in it)
  const stepping = usePendingStepUp() !== null && !isStepUp;
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const downOnBackdrop = useRef(false);
  useEffect(() => {
    opener.current ??= document.activeElement;
    const d = dialog.current;
    if (d && typeof d.showModal === 'function' && !d.open) d.showModal();
    else d?.setAttribute('open', '');
    // focus goes to the control that asks for it (the safe one in a confirmation), not to the first button
    d?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <dialog
      ref={dialog}
      className={wide ? `${styles.popup} ${styles.wide}` : styles.popup}
      style={stepping ? { display: 'none' } : undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === dialog.current;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === dialog.current) close();
      }}
    >
      <div className={styles.inner}>
        <div className={styles.top}>
          <h2 id={`${id}-title`} className={styles.title}>
            {title}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={close}
            disabled={busy}
            {...(decorativeClose ? { 'aria-hidden': true, tabIndex: -1 } : { 'aria-label': closeLabel })}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
              <path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** The popup's buttons as a ruled grid: the main action in an orange-washed cell, the others as plain cells; stacked on phones. */
export function PopupActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}
