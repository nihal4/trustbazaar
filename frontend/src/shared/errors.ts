// The message for an error (section 4.2, "Errors and messages"): generic, from the catalogue, chosen by
// status (SEC-INP-06). Numbers are shown in the page's digits.
import { ApiError } from '../lib/api.js';
import { toLocalDigits } from '../lib/money.js';
import type { T } from './language/catalogue';
import type { Lang } from './language/lang';

export function errorText(error: unknown, t: T, lang: Lang): string {
  if (!(error instanceof ApiError)) return t('shell.error.unexpected');
  const key = error.messageKey;
  if (key === 'error.rate_limited') {
    return t(key, { seconds: toLocalDigits(String(error.retryAfter ?? 60), lang) });
  }
  if (key === 'error.generic') return t(key, { ref: error.correlationId ?? '-' });
  return t(key);
}
