// <ConfirmDialog> (section 8.4): every action that moves money, ends a right or cannot be undone states its
// consequence with the real amounts and times, and the confirm button names the action and its amount rather
// than saying "OK". It is a Popup (the sheet over a blurred page, as every other popup): focus moves in, Escape and
// the close button cancel, focus returns to the opener.
import type { ReactNode } from 'react';
import { Popup, PopupActions } from './Popup';
import styles from './popup.module.css';

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
  return (
    <Popup id={id} title={title} closeLabel={cancelLabel} decorativeClose describedBy={`${id}-body`} busy={busy} onClose={onCancel}>
      <div id={`${id}-body`} className={styles.body}>{children}</div>
      <PopupActions>
        <button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>{confirmLabel}</button>
        <button type="button" onClick={onCancel} disabled={busy} data-autofocus>{cancelLabel}</button>
      </PopupActions>
    </Popup>
  );
}
