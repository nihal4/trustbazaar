// What the account screens share: their catalogue, the messages for Unit 1's refusals, and the move
// to the next page after signing in.
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toLocalDigits } from '../../lib/money.js';
import { errorText } from '../../shared/errors';
import { useT } from '../../shared/language/Language';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { ME_KEY } from '../../shared/me';
import { fieldErrors, isApiError, problemName } from '../../shared/problems';
import en from '../../messages/en/account.json';
import bn from '../../messages/bn/account.json';
import { inOtherDocument, PASSWORD, safeNext } from './input';

const CATALOGUES = { en, bn };

export const useAccountT = () => useT(CATALOGUES);

export const digits = (n: number, lang: Lang) => toLocalDigits(String(n), lang);

/** The message for a password Unit 1 refused, by its reason (Unit 1 section 6.1). */
export function passwordReasonText(reason: string, t: T, lang: Lang): string {
  switch (reason) {
    case 'too-short':
      return t('password.too_short', { min: digits(PASSWORD.minSingleFactor, lang), minMfa: digits(PASSWORD.minWithMfa, lang) });
    case 'too-long':
      return t('password.too_long', { max: digits(PASSWORD.max, lang) });
    case 'common':
      return t('password.common');
    case 'context':
      return t('password.context');
    case 'unchanged':
      return t('password.unchanged');
    default:
      return t('password.rejected');
  }
}

/** The reason of a password-rejected answer, if this is one. */
export function rejectedPasswordReason(error: unknown): string | null {
  if (problemName(error) !== 'password-rejected') return null;
  return fieldErrors(error)[0]?.reason ?? 'rejected';
}

/** Seconds to wait after a 429, or null. */
export const retryAfter = (error: unknown): number | null => (isApiError(error, 429) ? error.retryAfter ?? 60 : null);

/** The generic text for an answer no screen-specific message covers. */
export const otherError = (error: unknown, t: T, lang: Lang) => errorText(error, t, lang);

/**
 * After a session starts: the account is read again, and the user goes where they were going (a
 * path on this site only), with a normal page load if that path belongs to another document.
 */
export function useAfterSignIn() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (next: string | null) => {
    await queryClient.invalidateQueries({ queryKey: ME_KEY });
    const to = safeNext(next);
    if (inOtherDocument(to)) window.location.assign(to);
    else navigate(to, { replace: true });
  };
}
