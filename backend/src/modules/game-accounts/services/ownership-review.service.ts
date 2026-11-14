import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import type { Principal } from '../../../kernel/http/principal';
import { AUDIT_SERVICE, AuditServicePort, CallContext, FILE_VAULT, FileVaultPort, STAFF_QUERY, StaffQuery } from '../../identity/ports';
import { LISTINGS_COMMANDS, ListingsCommands } from '../../listings/ports';
import type { LiveCheck, ProofQueueItem } from '../ports';

// The operator's review of ownership proofs (docs/design/05_game_accounts.pdf section 5.2; FR-GAM-03, FR-GAM-04,
// FR-OPS-01; U5-02, second part): OwnershipReviewService.
//  - The queue: submitted proofs, oldest first (also Unit 7's ownership_proofs queue, through GameAccountQueries).
//  - The screenshot: a signed link valid CP-31, for the operator's session; each view audited by Unit 1's FileVault.
//  - The decision: game_accounts.review_proof records it (operator, time, live-profile check, reason) and, on approval,
//    takes the player-ID claim (claims_one_live); Unit 3 then publishes the listing or returns it to draft, in the same
//    transaction. A mismatch on the live profile, or an expired code, makes approval impossible (database rules).
//  - Claims of listings that end unsold, are cancelled or removed are released (ClaimConsumers). After a sale the claim
//    is released when the handover finishes (game_accounts.finish, U5-03).
// The operator must have no declared conflict with the seller (FR-OPS-06).

const REASONS: [string, string, string][] = [
  // [database message part, field, reason]
  ['not awaiting review', 'proof', 'not-awaiting-review'],
  ['ownership code has expired', 'code', 'code-expired'],
  ['player ID is already listed', 'playerId', 'player-id-claimed'],
];

@Injectable()
export class OwnershipReviewService {
  constructor(
    private readonly db: DataSource,
    @Inject(LISTINGS_COMMANDS) private readonly listings: ListingsCommands,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(STAFF_QUERY) private readonly staff: StaffQuery,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  /** GET /staff/game/ownership-proofs; GameAccountQueries.proofQueue for Unit 7's queue. */
  async proofQueue(limit = 200): Promise<ProofQueueItem[]> {
    const rows = (await this.db.query(
      `SELECT p.id, p.listing_id, d.seller_id, g.name, d.platform, d.player_id, p.submitted_at, p.expires_at
         FROM game_accounts.ownership_proofs p
         JOIN game_accounts.details d ON d.listing_id = p.listing_id
         JOIN game_accounts.games g ON g.id = d.game_id
        WHERE p.status = 'submitted' ORDER BY p.submitted_at, p.id LIMIT $1`,
      [limit],
    )) as { id: string; listing_id: string; seller_id: string; name: string; platform: string; player_id: string; submitted_at: Date; expires_at: Date }[];
    return rows.map((r) => ({
      proofId: r.id, listingId: r.listing_id, sellerId: r.seller_id, game: r.name, platform: r.platform, playerId: r.player_id, submittedAt: r.submitted_at, codeExpiresAt: r.expires_at,
    }));
  }

  async queue() {
    return {
      items: (await this.proofQueue()).map((p) => ({ ...p, submittedAt: p.submittedAt.toISOString(), codeExpiresAt: p.codeExpiresAt.toISOString() })),
    };
  }

  /** GET /staff/game/ownership-proofs/{id}/screenshot: a signed link (CP-31); the view is audited by the FileVault. */
  async screenshot(staff: Extract<Principal, { type: 'staff' }>, proofId: string, ctx: CallContext = {}) {
    const [p] = (await this.db.query(
      `SELECT p.screenshot_key, d.seller_id FROM game_accounts.ownership_proofs p JOIN game_accounts.details d ON d.listing_id = p.listing_id WHERE p.id = $1`,
      [proofId],
    )) as { screenshot_key: string | null; seller_id: string }[];
    if (!p?.screenshot_key) throw new Problem('not-found');
    await this.staff.assertNoConflict(staff.staffId, [p.seller_id]);
    return this.vault.signedLink(p.screenshot_key, staff, 'ownership proof review', ctx);
  }

  /** POST /staff/game/ownership-proofs/{id}/review. */
  async review(staffId: string, proofId: string, d: { approve: boolean; liveCheck: LiveCheck; reason?: string }, ctx: CallContext = {}, tx?: EntityManager): Promise<{ status: 'approved' | 'rejected' }> {
    const reason = d.reason?.normalize('NFC').trim() || null;
    if (!d.approve && (reason?.length ?? 0) < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'required' }] });
    if (d.approve && d.liveCheck === 'not_matched') throw new Problem('validation-failed', { errors: [{ field: 'liveCheck', reason: 'live-check-not-matched' }] });
    if (d.approve && (await this.params.current()).get<boolean>('CP-36') !== true) throw new Problem('feature-off'); // FR-GAM-01
    const run = async (m: EntityManager) => {
      const [p] = (await m.query(
        `SELECT p.listing_id, d.seller_id FROM game_accounts.ownership_proofs p JOIN game_accounts.details d ON d.listing_id = p.listing_id WHERE p.id = $1`,
        [proofId],
      )) as { listing_id: string; seller_id: string }[];
      if (!p) throw new Problem('not-found');
      await this.staff.assertNoConflict(staffId, [p.seller_id]);
      const [{ status }] = (await m.query(`SELECT game_accounts.review_proof($1, $2, $3, $4, $5) AS status`, [proofId, staffId, d.approve, d.liveCheck, reason])) as
        { status: 'approved' | 'rejected' }[];
      if (d.approve) await this.listings.approveForPublication(p.listing_id, staffId, reason ?? 'game-account ownership approved', m);
      else await this.listings.returnToDraft(p.listing_id, staffId, `game-account ownership rejected: ${reason}`, m);
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: `games.ownership.${status}`, objectType: 'listing', objectId: p.listing_id,
        after: { proofId, liveCheck: d.liveCheck }, reason, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
      return { status };
    };
    try {
      return await (tx ? run(tx) : this.db.transaction(run));
    } catch (err) {
      if (err instanceof QueryFailedError) {
        const message = (err.driverError as { message?: string }).message ?? '';
        const hit = REASONS.find(([part]) => message.includes(part));
        if (hit?.[0] === 'not awaiting review') throw new Problem('listing-state', { errors: [{ field: hit[1], reason: hit[2] }] });
        if (hit) throw new Problem('validation-failed', { errors: [{ field: hit[1], reason: hit[2] }] });
      }
      throw err;
    }
  }

  /** GameAccountCommands.reviewProof (Unit 7). */
  async reviewProof(proofId: string, staffId: string, approve: boolean, liveCheck: LiveCheck, reason?: string, tx?: EntityManager): Promise<void> {
    await this.review(staffId, proofId, { approve, liveCheck, reason }, {}, tx);
  }

  /** FR-GAM-04: a listing that ends unsold, is cancelled or removed releases its claim; a sold one keeps it. */
  async releaseForListing(listingId: string): Promise<number> {
    const [, n] = (await this.db.query(
      `UPDATE game_accounts.claims SET released_at = now(), release_reason = 'listing_ended' WHERE listing_id = $1 AND released_at IS NULL AND order_id IS NULL`,
      [listingId],
    )) as [unknown, number];
    return n;
  }
}
