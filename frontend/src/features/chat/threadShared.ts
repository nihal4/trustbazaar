/** DV-40 */
export const MAX_TEXT = 2000;

export const CATEGORIES = ['fraudulent', 'counterfeit', 'prohibited', 'misrepresented', 'abusive'] as const;

export type Category = (typeof CATEGORIES)[number];

/** A report of the thread (seq null) or of one of the other party's messages, to the report queue (Unit 7). It opens in a popup over the page;
 *  the answer after it closes is given by the caller (`onNote`, for the thread) or under the button (for a message). */
export type Note = { kind: 'error' | 'success' | 'info'; text: string };
