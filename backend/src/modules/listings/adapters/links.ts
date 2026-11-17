import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { AccountLink, AccountLinkSource, LinkVia } from '../../../kernel/links/account-links';
import { ORDERS_ACCOUNT_LINKS } from '../../orders/ports';
import { DISPUTE_QUERIES, DisputeQueries } from '../../trust/ports';

// U7-09. Units 2 and 7 import this unit, so their ports are found on first use, as for the auction orders
// (adapters/orders.ts): Unit 2's payout links for the shill check linked_to_seller (FR-TNS-08), and Unit 7's
// disputed sales for the relisting flag (FR-TNS-02).
export const SHILL_PAYOUT_LINKS = Symbol('SHILL_PAYOUT_LINKS');
export const RELISTING_DISPUTES = Symbol('RELISTING_DISPUTES');

@Injectable()
export class ForwardedPayoutLinks implements AccountLinkSource {
  constructor(private readonly modules: ModuleRef) {}

  private get port(): AccountLinkSource {
    return this.modules.get<AccountLinkSource>(ORDERS_ACCOUNT_LINKS, { strict: false });
  }

  pairs(): Promise<AccountLink[]> {
    return this.port.pairs();
  }

  linkedTo(userId: string, others: string[]): Promise<{ userId: string; via: LinkVia }[]> {
    return this.port.linkedTo(userId, others);
  }
}

@Injectable()
export class ForwardedDisputes implements DisputeQueries {
  constructor(private readonly modules: ModuleRef) {}

  disputedListings(sellerId: string, withinDays: number): Promise<string[]> {
    return this.modules.get<DisputeQueries>(DISPUTE_QUERIES, { strict: false }).disputedListings(sellerId, withinDays);
  }
}
