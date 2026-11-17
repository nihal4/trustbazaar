// The seller's data (docs/design/08_frontend.pdf section 7.8; U8-09): the fields of GET /orders (Unit 2) and
// GET /me/payout-account that the dashboard and the payout account page read, and which orders need the seller.
import { formatDateTime } from '../../lib/time.js';
import type { T } from '../../shared/language/catalogue';
import type { Lang } from '../../shared/language/lang';

export interface SellerOrder {
  id: string;
  status: 'awaiting_payment' | 'paid' | 'cancelled' | 'closed';
  listing: { id: string; title: string };
  fulfilment: 'self_pickup' | 'courier' | 'game_account' | null;
  fulfilmentDueAt: string | null;
  deliveryEventAt: string | null;
  cancellationRequest?: null | { id: string; status: 'pending' | 'accepted' | 'declined' | 'lapsed' };
  escrow: null | { state: string };
}

export interface PayoutAccount {
  id: string; kind: 'bkash_wallet' | 'nagad_wallet' | 'bank'; status: 'pending_review' | 'cooling_off' | 'active' | 'rejected' | 'replaced';
  walletMasked: string | null; bankName: string | null; branchName: string | null; accountName: string | null; accountLast4: string | null;
  effectiveAt: string | null; createdAt: string;
}

export type Why = 'cancel_request' | 'hand_over' | 'ship';

/**
 * Section 7.8: the orders that need the seller now, the earliest deadline first: a buyer's cancellation request, then
 * every paid order not yet handed over or shipped, by its fulfilment deadline. Pure, for the tests.
 */
export function needingAction(orders: SellerOrder[]): { order: SellerOrder; why: Why; due: number | null }[] {
  const out: { order: SellerOrder; why: Why; due: number | null }[] = [];
  for (const o of orders) {
    if (o.status !== 'paid' || o.escrow?.state !== 'held' || o.deliveryEventAt !== null) continue;
    const due = o.fulfilmentDueAt ? Date.parse(o.fulfilmentDueAt) : null;
    if (o.cancellationRequest?.status === 'pending') out.push({ order: o, why: 'cancel_request', due });
    else if (o.fulfilment === 'courier') out.push({ order: o, why: 'ship', due });
    else if (o.fulfilment === 'self_pickup') out.push({ order: o, why: 'hand_over', due });
  }
  const rank = (w: Why) => (w === 'cancel_request' ? 0 : 1);
  return out.sort((a, b) => rank(a.why) - rank(b.why) || (a.due ?? Infinity) - (b.due ?? Infinity));
}

export function accountLine(a: PayoutAccount, t: T): string {
  return a.kind === 'bank'
    ? t('seller.account_bank', { bank: a.bankName ?? '', last4: a.accountLast4 ?? '' })
    : t(`seller.account_${a.kind}`, { number: a.walletMasked ?? '' });
}

export function accountStatus(a: PayoutAccount, t: T, lang: Lang): string {
  if (a.status === 'cooling_off' && a.effectiveAt) return t('seller.account_status.cooling_off', { at: formatDateTime(Date.parse(a.effectiveAt), lang) });
  return t(`seller.account_status.${a.status}`);
}

