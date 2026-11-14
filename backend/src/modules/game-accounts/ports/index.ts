import type { EntityManager } from 'typeorm';

// The public surface of Unit 5: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/05_game_accounts.pdf section 3.2; docs/design/09_integration.pdf, section 2.1),
// added by the unit's tasks:
//   GameAccountPort      (U5-03)
//   GameAccountCommands  (reviewProof: U5-02, below; disputeWithdrawn: U5-04)
//   GameAccountQueries   (proofQueue: U5-02, below; evidence, credentialsInvalidAllowed, deadlines: U5-04, U7-10)

export type LiveCheck = 'matched' | 'not_matched' | 'not_available';

/** Used by Unit 7. */
export interface GameAccountCommands {
  /**
   * FR-GAM-03, FR-GAM-04: an operator's decision on a submitted ownership proof. Approval takes the player-ID claim and
   * publishes the listing (Unit 3) in one transaction; rejection needs a reason (10 characters or more) and returns the
   * listing to draft. Refusals: listing-state (not awaiting review, or the listing is not held), validation-failed with
   * code-expired, live-check-not-matched, reason or player-id-claimed, conflict-of-interest, feature-off (approval while
   * CP-36 is off).
   */
  reviewProof(proofId: string, staffId: string, approve: boolean, liveCheck: LiveCheck, reason?: string, tx?: EntityManager): Promise<void>;
}
export const GAME_ACCOUNT_COMMANDS = Symbol('GAME_ACCOUNT_COMMANDS');

/** A submitted proof awaiting an operator (FR-OPS-01's ownership_proofs queue). */
export interface ProofQueueItem {
  proofId: string;
  listingId: string;
  sellerId: string;
  game: string;
  platform: string;
  playerId: string;
  submittedAt: Date;
  codeExpiresAt: Date;
}

/** Used by Units 6 and 7. */
export interface GameAccountQueries {
  /** The proofs awaiting review, oldest first. */
  proofQueue(limit?: number): Promise<ProofQueueItem[]>;
}
export const GAME_ACCOUNT_QUERIES = Symbol('GAME_ACCOUNT_QUERIES');
