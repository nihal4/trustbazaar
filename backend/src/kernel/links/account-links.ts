// Linked accounts (docs/design/07_disputes_trust_staff.pdf section 6.2, 03_listings_auctions.pdf section 5.8;
// FR-TNS-08; U7-09). Unit 1 (devices) and Unit 2 (payout accounts) each offer an AccountLinkSource through their ports.
// Unit 7's daily check turns every pair into a signal for review; Unit 3's shill check asks whether an auction's
// bidders are linked to its seller. Payment instruments join with the real payment providers (U2-09).

/** What two accounts share: a browser (its device key), a payout wallet number, or a bank account. */
export type LinkVia = 'device' | 'payout_wallet' | 'payout_bank';

export interface AccountLink {
  via: LinkVia;
  /** The account that used the shared thing later. */
  userId: string;
  /** The account that used it first. */
  linkedTo: string;
  /** When the later account first used it. */
  at: Date;
}

export interface AccountLinkSource {
  /** Every pair of accounts that share something, at most once per pair and kind. */
  pairs(): Promise<AccountLink[]>;
  /** Of the `others`, those that share something with `userId`, with what. */
  linkedTo(userId: string, others: string[]): Promise<{ userId: string; via: LinkVia }[]>;
}
