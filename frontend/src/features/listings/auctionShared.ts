// What the auction's parts share: formatting a price, the amount check of a bid and the words for each refusal.
import { formatMoney } from '../../lib/money.js';
import { formatDateTime } from '../../lib/time.js';
import { ApiError } from '../../lib/api.js';
import { errorText } from '../../shared/errors';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';
import { problemName } from '../../shared/problems';

export const money = (p: string | bigint, lang: Lang) => formatMoney(p, lang);

export const amountError = (reason: string, t: T) => t(`auction.amount.${reason}`);

/** A refused bid in words (Decisions log, U3-04: 422 bid-refused with a stable reason; 409 auction-busy). */
export function refusalText(e: unknown, t: T, lang: Lang): string {
  const name = problemName(e);
  if (name === 'auction-busy') return t('auction.busy');
  if (name === 'transaction-not-allowed') return t('auction.not_allowed');
  if (name === 'bid-refused' && e instanceof ApiError && Array.isArray(e.errors)) {
    const r = e.errors[0] as { reason?: string; minimum?: string; until?: string };
    if (r?.reason === 'below_minimum' && r.minimum) return t('auction.refused.below_minimum', { amount: money(r.minimum, lang) });
    if (r?.reason === 'bidder_restricted') return t('auction.refused.bidder_restricted', { until: r.until ? formatDateTime(Date.parse(r.until), lang) : '-' });
    if (r?.reason && ['max_not_higher', 'auction_ended', 'auction_not_open', 'seller_cannot_bid'].includes(r.reason)) return t(`auction.refused.${r.reason}`);
  }
  return errorText(e, t, lang);
}
