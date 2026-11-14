import type { ModuleRef } from '@nestjs/core';
import type { VerifiedAction } from '../../../kernel/http/policies';
import { SANCTION_PORT, SanctionPort } from '../../trust/ports';

// @Verified(action) also requires that the user has no restriction for the action (Unit 1 section 4.1).
// Restrictions are decided by Unit 7 and read through its SanctionPort (I-43, U7-04): listing needs canSell, bidding
// and buying need canBuyBid. Unit 7 imports this unit, so its port is found on first use rather than injected.
export interface Restrictions {
  isRestricted(userId: string, action: VerifiedAction): Promise<boolean>;
}

export const RESTRICTIONS = Symbol('RESTRICTIONS');

export function sanctionRestrictions(modules: Pick<ModuleRef, 'get'>): Restrictions {
  return {
    async isRestricted(userId, action) {
      if (action === 'payout') return false; // payouts are held by Unit 2 on a fraud flag (FR-TNS-05), not refused here
      const r = await modules.get<SanctionPort>(SANCTION_PORT, { strict: false }).restrictions(userId);
      return action === 'list' ? !r.canSell : !r.canBuyBid;
    },
  };
}
