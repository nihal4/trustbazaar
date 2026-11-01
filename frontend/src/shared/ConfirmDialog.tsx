// <ConfirmDialog> (section 8.4): every action that moves money, ends a right or cannot be undone states its
// consequence with the real amounts and times, and the confirm button names the action and its amount rather
// than saying "OK". Native <dialog>: focus moves in, Escape cancels, focus returns to the opener.
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './shell.module.css';

export interface ConfirmDialogProps {
  id: string;
  title: string;
  /** The consequence messages (catalogue keys confirm.*), filled in. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ id, title, children, confirmLabel, cancelLabel, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const d = dialog.current;
    if (d && typeof d.showModal === 'function' && !d.open) d.showModal();
    else d?.setAttribute('open', '');
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);
  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div id={`${id}-body`}>{children}</div>
      <div className={styles.dialogActions}>
        <button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy} autoFocus>{confirmLabel}</button>
        <button type="button" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
      </div>
    </dialog>
  );
}
