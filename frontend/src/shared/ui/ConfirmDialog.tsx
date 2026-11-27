// A confirmation (U11-05; section 8.4 of docs/design/08_frontend.pdf): every action that moves money, ends a right or cannot be undone states its consequence with the real amounts and
// times, and the confirm button names the action and its amount rather than saying "OK". It is a Popup: focus starts on the safe choice (cancel), Escape and the close button cancel.
import type { ReactNode } from 'react';
import { Popup, PopupActions } from './Popup';
import styles from './popup.module.css';

export interface ConfirmDialogProps {
  id: string;
  title: string;
  /** The consequence messages, filled in. */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  hidden?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ id, title, children, confirmLabel, cancelLabel, busy = false, hidden = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Popup id={id} title={title} closeLabel={cancelLabel} decorativeClose describedBy={`${id}-body`} busy={busy} hidden={hidden} onClose={onCancel}>
      <div id={`${id}-body`} className={styles.body}>
        {children}
      </div>
      <PopupActions>
        <button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} data-autofocus>
          {cancelLabel}
        </button>
      </PopupActions>
    </Popup>
  );
}
