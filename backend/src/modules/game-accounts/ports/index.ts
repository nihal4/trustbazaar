import type { EntityManager } from 'typeorm';

// The public surface of Unit 5: the only files other units may import (DC-1).
// Ports this unit provides (docs/design/05_game_accounts.pdf section 3.2; docs/design/09_integration.pdf, section 2.1),
// added by the unit's tasks:
//   GameAccountPort      (assertCheckoutReady: U5-03, below)
//   GameAccountCommands  (reviewProof: U5-02; disputeWithdrawn: U5-04; below)
//   GameAccountQueries   (proofQueue: U5-02; credentialsInvalidAllowed: U5-04; below. evidence, deadlines: U7-10)

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
  /** FR-DSP-10: a withdrawn credentials_invalid dispute; the takeover resumes (its window, if over, ends at the next job run). */
  disputeWithdrawn(orderId: string, tx: EntityManager): Promise<void>;
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
  /** FR-GAM-14: during the takeover window and before the recovery e-mail step is confirmed. */
  credentialsInvalidAllowed(orderId: string): Promise<boolean>;
}
export const GAME_ACCOUNT_QUERIES = Symbol('GAME_ACCOUNT_QUERIES');

/**
 * The current version of the publisher-risk disclosure (FR-GAM-05) that the buyer acknowledges before paying. The text
 * is the web client's; a new text is a new version here (Decisions log, U5-03).
 */
export const DISCLOSURE_VERSION = 1;

/** Used by Unit 2 (I-29). */
export interface GameAccountPort {
  /**
   * Before a game-account order's payment starts: CP-36 on (else feature-off), the disclosure acknowledged and the
   * buyer's key registered (else order-state with checkout-not-ready).
   */
  assertCheckoutReady(orderId: string): Promise<void>;
}
export const GAME_ACCOUNT_PORT = Symbol('GAME_ACCOUNT_PORT');
