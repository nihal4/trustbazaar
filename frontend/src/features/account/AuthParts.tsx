// The parts the bare account pages (sign-in, registration) share (U10-25, U10-25): the line under a field where a refusal or a notice is said, and what a
// field with a message says to assistive technology.
import styles from './account.module.css';

/** The line under the field where a refusal or a notice is said. It takes its own height out of the room the form shares out (a few pixels: it
 *  does not keep an empty place, which made the gaps uneven). Its two regions are always in the page (a region that appears with its text is
 *  often not announced): a refusal is an alert, a notice is a status; the message has an id the field points to. */
export function Slot({ message, ok = false, id }: { message: string | null; ok?: boolean; id: string }) {
  return (
    <div className={styles.slot}>
      <div role="alert">{message && !ok && <p id={id} className={styles.slotError}>{message}</p>}</div>
      <div role="status">{message && ok && <p id={id} className={styles.slotOk}>{message}</p>}</div>
    </div>
  );
}

/** What a field with a message says to assistive technology: it is invalid when there is a refusal, and described by the heading and by the message. */
export const fieldAria = (message: string | null, ok: boolean, messageId: string, headId = 'signin-head') => ({
  'aria-invalid': message && !ok ? true : undefined,
  'aria-describedby': [headId, message ? messageId : ''].filter(Boolean).join(' '),
});
