import { errorText } from '../../shared/errors';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';

export const MAX_CAPTION = 300;

export const SendIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M4 12 L20 4 L14 20 L11 13 Z M11 13 L20 4" {...stroke} />
  </svg>
);

export const ClipIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M20 11 L12 19 a5 5 0 0 1 -7 -7 L13 4 a3.5 3.5 0 0 1 5 5 L10 17 a2 2 0 0 1 -3 -3 L14 7" {...stroke} />
  </svg>
);

/** A chat-specific message for the problems the chat answers, else the generic one. */
export function chatError(e: unknown, t: T, lang: Lang): string {
  const name = problemName(e);
  if (name === 'blocked') return t('error.blocked');
  if (name === 'thread-closed') return t('error.thread_closed');
  return errorText(e, t, lang);
}

export const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
