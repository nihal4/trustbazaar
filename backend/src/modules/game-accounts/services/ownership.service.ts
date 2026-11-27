import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, CallContext, FILE_VAULT, FileVaultPort } from '../../identity/ports';
import { LISTINGS_PORT, ListingSnapshot, ListingsPort } from '../../listings/ports';

// Listing a game account, the seller's side and the catalogue (docs/design/05_game_accounts.pdf section 5; FR-GAM-01 to
// FR-GAM-03; U5-02). The review, the player-ID claim and publication are OwnershipReviewService's.
//  - The catalogue: games with their platforms, where the ownership code goes and the publisher's note; administrators
//    maintain it (audited), everyone reads the active games.
//  - Game details (FR-GAM-02): game, platform, player ID and contents, on the seller's own game-account listing while it
//    is a draft or held for review; never any login detail. Fixed once a proof is submitted (details_guard).
//  - Ownership code (FR-GAM-03): `TB-XXXX-XXXX`, 40 random bits in Crockford base32 without I, L, O and U, valid DV-33
//    (7 days). Asking again replaces an unused code. Not a secret: it proves control of the profile now.
//  - Proof: the screenshot showing the code and the player ID, re-encoded without metadata and encrypted by Unit 1's
//    FileVault (purpose ownership_proof); the proof is then submitted for review. The listing must be held for review
//    (the seller asked to publish it), since the operator's approval publishes it (Decisions log, U5-02).
//  - While CP-36 is off, all of this answers feature-off (FR-GAM-01).

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_VALID_MS = 7 * 86_400_000; // DV-33
const EDITABLE = ['draft', 'pending_review'];

export function ownershipCode(bytes: Buffer = randomBytes(5)): string {
  let n = BigInt(`0x${bytes.subarray(0, 5).toString('hex')}`);
  let s = '';
  for (let i = 0; i < 8; i++) {
    s = CROCKFORD[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return `TB-${s.slice(0, 4)}-${s.slice(4)}`;
}

export interface GameView {
  id: number;
  slug: string;
  name: string;
  platforms: string[];
  codePlacement: string;
  publisherNote: string;
  active: boolean;
}

@Injectable()
export class OwnershipService {
  constructor(
    private readonly db: DataSource,
    @Inject(LISTINGS_PORT) private readonly listings: ListingsPort,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ------------------------------------------------------------------ the catalogue

  /** GET /games: the active games, by name. */
  async games(): Promise<{ items: Omit<GameView, 'active'>[] }> {
    const rows = (await this.db.query(`SELECT * FROM game_accounts.games WHERE active ORDER BY name`)) as Record<string, unknown>[];
    return {
      items: rows
        .map((r) => this.game(r))
        .map(({ id, slug, name, platforms, codePlacement, publisherNote }) => ({ id, slug, name, platforms, codePlacement, publisherNote })),
    };
  }

  /** POST /admin/games. */
  async addGame(staffId: string, g: Omit<GameView, 'id' | 'active'>, ctx: CallContext = {}): Promise<GameView> {
    try {
      return await this.db.transaction(async (m) => {
        const [row] = (await m.query(
          `INSERT INTO game_accounts.games (slug, name, platforms, code_placement, publisher_note) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [g.slug, g.name.trim(), g.platforms.map((p) => p.trim()), g.codePlacement.trim(), g.publisherNote.trim()],
        )) as Record<string, unknown>[];
        const view = this.game(row);
        await this.audit.record(
          {
            actorType: 'staff',
            actorId: staffId,
            action: 'games.catalogue.added',
            objectType: 'game',
            objectId: null,
            after: { ...view },
            sourceIp: ctx.ip ?? null,
            correlationId: ctx.correlationId ?? null,
          },
          m,
        );
        return view;
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505')
        throw new Problem('validation-failed', { errors: [{ field: 'slug', reason: 'taken' }] });
      throw err;
    }
  }

  /** PATCH /admin/games/{id}: name, platforms, placement, note, active. */
  async updateGame(staffId: string, id: number, g: Partial<Omit<GameView, 'id' | 'slug'>>, ctx: CallContext = {}): Promise<GameView> {
    return this.db.transaction(async (m) => {
      const [before] = (await m.query(`SELECT * FROM game_accounts.games WHERE id = $1 FOR UPDATE`, [id])) as Record<string, unknown>[];
      if (!before) throw new Problem('not-found');
      const b = this.game(before);
      const next = { ...b, ...Object.fromEntries(Object.entries(g).filter(([, v]) => v !== undefined)) } as GameView;
      const [[row]] = (await m.query(
        `UPDATE game_accounts.games SET name = $2, platforms = $3, code_placement = $4, publisher_note = $5, active = $6 WHERE id = $1 RETURNING *`,
        [id, next.name.trim(), next.platforms.map((p) => p.trim()), next.codePlacement.trim(), next.publisherNote.trim(), next.active],
      )) as [Record<string, unknown>[], number];
      const view = this.game(row);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staffId,
          action: 'games.catalogue.updated',
          objectType: 'game',
          objectId: null,
          before: { ...b },
          after: { ...view },
          sourceIp: ctx.ip ?? null,
          correlationId: ctx.correlationId ?? null,
        },
        m,
      );
      return view;
    });
  }

  // ------------------------------------------------------------------ the seller's side

  /** PUT /listings/{id}/game-details (FR-GAM-02). */
  async setDetails(sellerId: string, listingId: string, d: { gameId: number; platform: string; playerId: string; contents: string }) {
    await this.ownGameListing(sellerId, listingId);
    const playerId = d.playerId.normalize('NFC').trim();
    const contents = d.contents.normalize('NFC').trim();
    const [game] = (await this.db.query(`SELECT platforms FROM game_accounts.games WHERE id = $1 AND active`, [d.gameId])) as { platforms: string[] }[];
    if (!game) throw new Problem('validation-failed', { errors: [{ field: 'gameId', reason: 'unknown' }] });
    if (!game.platforms.includes(d.platform)) throw new Problem('validation-failed', { errors: [{ field: 'platform', reason: 'not-offered' }] });
    try {
      const [row] = (await this.db.query(
        `INSERT INTO game_accounts.details (listing_id, seller_id, game_id, platform, player_id, contents) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (listing_id) DO UPDATE SET game_id = EXCLUDED.game_id, platform = EXCLUDED.platform, player_id = EXCLUDED.player_id, contents = EXCLUDED.contents
         RETURNING listing_id, game_id, platform, player_id, contents`,
        [listingId, sellerId, d.gameId, d.platform, playerId, contents],
      )) as { listing_id: string; game_id: number; platform: string; player_id: string; contents: string }[];
      return { listingId: row.listing_id, gameId: row.game_id, platform: row.platform, playerId: row.player_id, contents: row.contents };
    } catch (err) {
      const e = err instanceof QueryFailedError ? (err.driverError as { code?: string; message?: string }) : {};
      if (e.message?.includes('fixed once ownership proof'))
        throw new Problem('validation-failed', { errors: [{ field: 'playerId', reason: 'fixed-after-proof' }] });
      if (e.code === '23514') throw new Problem('validation-failed', { errors: [{ field: 'playerId', reason: 'invalid' }] });
      throw err;
    }
  }

  /** POST /listings/{id}/ownership-code (FR-GAM-03): a fresh code, valid DV-33; an unused one is replaced. */
  async issueCode(sellerId: string, listingId: string): Promise<{ code: string; expiresAt: string; placement: string }> {
    await this.ownGameListing(sellerId, listingId);
    const [details] = (await this.db.query(
      `SELECT g.code_placement FROM game_accounts.details d JOIN game_accounts.games g ON g.id = d.game_id WHERE d.listing_id = $1`,
      [listingId],
    )) as { code_placement: string }[];
    if (!details) throw new Problem('validation-failed', { errors: [{ field: 'listing', reason: 'game-details-missing' }] });
    const now = this.clock.now();
    return this.db.transaction(async (m) => {
      const [open] = (await m.query(
        `SELECT id, status FROM game_accounts.ownership_proofs WHERE listing_id = $1 AND status IN ('issued', 'submitted') FOR UPDATE`,
        [listingId],
      )) as { id: string; status: string }[];
      if (open?.status === 'submitted') throw new Problem('validation-failed', { errors: [{ field: 'listing', reason: 'proof-under-review' }] });
      if (open) await m.query(`UPDATE game_accounts.ownership_proofs SET status = 'expired' WHERE id = $1`, [open.id]);
      const expires = new Date(now.getTime() + CODE_VALID_MS);
      for (let attempt = 0; ; attempt++) {
        const code = ownershipCode();
        try {
          await m.query(`SAVEPOINT code`);
          await m.query(`INSERT INTO game_accounts.ownership_proofs (listing_id, code, issued_at, expires_at) VALUES ($1, $2, $3, $4)`, [
            listingId,
            code,
            now,
            expires,
          ]);
          await m.query(`RELEASE SAVEPOINT code`);
          return { code, expiresAt: expires.toISOString(), placement: details.code_placement };
        } catch (err) {
          await m.query(`ROLLBACK TO SAVEPOINT code`);
          if (attempt >= 3 || !(err instanceof QueryFailedError) || (err.driverError as { code?: string }).code !== '23505') throw err; // a code taken twice in 2^40
        }
      }
    });
  }

  /** POST /listings/{id}/ownership-proof: the screenshot with the code and player ID; the proof goes to review. */
  async submitProof(sellerId: string, listingId: string, file: { buffer: Buffer; mimetype: string }): Promise<{ status: 'submitted'; submittedAt: string }> {
    const listing = await this.ownGameListing(sellerId, listingId);
    // the operator's approval publishes the listing, so the seller has asked to publish it first (Decisions log, U5-02)
    if (listing.status !== 'pending_review') throw new Problem('validation-failed', { errors: [{ field: 'listing', reason: 'not-submitted-for-review' }] });
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
      throw new Problem('validation-failed', { errors: [{ field: 'file', reason: 'type' }] });
    const [proof] = (await this.db.query(`SELECT id, expires_at FROM game_accounts.ownership_proofs WHERE listing_id = $1 AND status = 'issued'`, [
      listingId,
    ])) as { id: string; expires_at: Date }[];
    if (!proof) throw new Problem('validation-failed', { errors: [{ field: 'listing', reason: 'no-code' }] });
    if (proof.expires_at <= this.clock.now()) throw new Problem('validation-failed', { errors: [{ field: 'code', reason: 'code-expired' }] });
    const stored = await this.vault.store({ purpose: 'ownership_proof', ownerId: sellerId, bytes: new Uint8Array(file.buffer) });
    const [rows] = (await this.db.query(
      `UPDATE game_accounts.ownership_proofs SET status = 'submitted', screenshot_key = $2, screenshot_sha256 = decode($3, 'hex'), submitted_at = now()
        WHERE id = $1 AND status = 'issued' RETURNING submitted_at`,
      [proof.id, stored.key, stored.sha256],
    )) as [{ submitted_at: Date }[], number];
    if (!rows.length) {
      await this.vault.erase(stored.key).catch(() => undefined);
      throw new Problem('validation-failed', { errors: [{ field: 'listing', reason: 'no-code' }] }); // replaced meanwhile
    }
    return { status: 'submitted', submittedAt: rows[0].submitted_at.toISOString() };
  }

  /** GET /listings/{id}/ownership: the seller's own view of the details and the proof (no screenshot). */
  async status(sellerId: string, listingId: string) {
    await this.ownGameListing(sellerId, listingId, true);
    const [d] = (await this.db.query(`SELECT game_id, platform, player_id, contents FROM game_accounts.details WHERE listing_id = $1`, [listingId])) as {
      game_id: number;
      platform: string;
      player_id: string;
      contents: string;
    }[];
    const [p] = (await this.db.query(
      `SELECT code, status, expires_at, submitted_at, reviewed_at, live_check, review_reason FROM game_accounts.ownership_proofs WHERE listing_id = $1 ORDER BY issued_at DESC LIMIT 1`,
      [listingId],
    )) as { code: string; status: string; expires_at: Date; submitted_at: Date | null; reviewed_at: Date | null; review_reason: string | null }[];
    return {
      details: d ? { gameId: d.game_id, platform: d.platform, playerId: d.player_id, contents: d.contents } : null,
      proof: p
        ? {
            code: p.code,
            status: p.status === 'issued' && p.expires_at <= this.clock.now() ? 'expired' : p.status,
            expiresAt: p.expires_at.toISOString(),
            submittedAt: p.submitted_at?.toISOString() ?? null,
            reviewedAt: p.reviewed_at?.toISOString() ?? null,
            reason: p.status === 'rejected' ? p.review_reason : null,
          }
        : null,
    };
  }

  /** The seller's own game-account listing, still editable; CP-36 on (FR-GAM-01). Others get not-found. */
  private async ownGameListing(sellerId: string, listingId: string, anyStatus = false): Promise<ListingSnapshot> {
    if ((await this.params.current()).get<boolean>('CP-36') !== true) throw new Problem('feature-off');
    const l = await this.listings.snapshot(listingId).catch(() => null);
    if (!l || l.sellerId !== sellerId || l.itemKind !== 'game_account') throw new Problem('not-found');
    if (!anyStatus && !EDITABLE.includes(l.status)) throw new Problem('validation-failed', { errors: [{ field: 'listing', reason: 'not-editable' }] });
    return l;
  }

  private game(r: Record<string, unknown>): GameView {
    return {
      id: Number(r.id),
      slug: String(r.slug),
      name: String(r.name),
      platforms: r.platforms as string[],
      codePlacement: String(r.code_placement),
      publisherNote: String(r.publisher_note),
      active: Boolean(r.active),
    };
  }
}
