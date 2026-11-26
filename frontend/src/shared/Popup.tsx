// A popup over a blurred page (U10-23): a native <dialog> in the sheet look of the payment sheet: focus moves in, Escape and a click on the blur close it,
// focus returns to the opener. The content is the caller's (a form to fill in); the caller owns the buttons.
import { useEffect, useRef, type ReactNode } from 'react';
import styles from './popup.module.css';

export function Popup({ id, title, closeLabel, busy = false, onClose, children }: { id: string; title: string; closeLabel: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    opener.current = document.activeElement;
    const d = dialog.current;
    if (d && typeof d.showModal === 'function' && !d.open) d.showModal();
    else d?.setAttribute('open', '');
    return () => { if (opener.current instanceof HTMLElement) opener.current.focus(); };
  }, []);
  const close = () => { if (!busy) onClose(); };
  return (
    <dialog ref={dialog} className={styles.popup} aria-labelledby={`${id}-title`} onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === dialog.current) close(); }}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <h2 id={`${id}-title`} className={styles.title}>{title}</h2>
          <button type="button" className={styles.close} onClick={close} disabled={busy} aria-label={closeLabel}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
