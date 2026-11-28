// The parts the bare account pages (sign-in, registration) share (U10-25, U10-25): the line under a field where a refusal or a notice is said, and what a
// field with a message says to assistive technology.
import type { ReactNode } from 'react';
import styles from './account.module.css';

/** The line under the field where a refusal or a notice is said. It takes its own height out of the room the form shares out (a few pixels: it
 *  does not keep an empty place, which made the gaps uneven). Its two regions are always in the page (a region that appears with its text is
 *  often not announced): a refusal is an alert, a notice is a status; the message has an id the field points to. */
export function Slot({ message, ok = false, id }: { message: string | null; ok?: boolean; id: string }) {
  return (
    <div className={styles.slot}>
      <div role="alert">
        {message && !ok && (
          <p id={id} className={styles.slotError}>
            {message}
          </p>
        )}
      </div>
      <div role="status">
        {message && ok && (
          <p id={id} className={styles.slotOk}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

/** What a field with a message says to assistive technology: it is invalid when there is a refusal, and described by the heading and by the message. */
export const fieldAria = (message: string | null, ok: boolean, messageId: string, headId = 'signin-head') => ({
  'aria-invalid': message && !ok ? true : undefined,
  'aria-describedby': [headId, message ? messageId : ''].filter(Boolean).join(' '),
});

/** The card's bands in cells, shared by the pages that are several steps long (U10-25). The heading band wraps more lines on a narrow screen; the form band is
 *  sized for the tallest step with a message under it (two fields and a message need more room on a phone). One height for every step of a page. */
export const headFor = (vw: number, bangla: boolean) => {
  if (vw < 360) return bangla ? 8 : 7;
  if (vw < 520) return bangla ? 7 : 6;
  return 5;
};
const bodyFor = (vw: number) => {
  if (vw < 360) return 14;
  return vw < 520 ? 13 : 11;
};
const rowsFor = (vw: number, bangla: boolean, body = bodyFor(vw), foot = 2) => headFor(vw, bangla) + body + foot;

/** THE card of every bare page (sign-in, registration, reset, verify): one size in every step of every page, sized for the tallest step of any of them (the
 *  reset by SMS with the second factor and a message), so the card never changes shape between steps or between pages. */
export const authRows = (vw: number, bangla: boolean) => rowsFor(vw, bangla, bodyFor(vw) + 2);

/** The form band of a step that has no field: a message, then (maybe) the one button. */
export function StepNote({ children }: { children: ReactNode }) {
  return <div className={styles.stepNote}>{children}</div>;
}
