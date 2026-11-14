import { Inject, Injectable } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, CallContext, IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import type { ProfileSummary, TrustQuery } from '../ports';

// Ratings and the profile summary (docs/design/07_disputes_trust_staff.pdf section 7; FR-REV-01 to FR-REV-07; U7-05).
//  - An order whose escrow reaches a terminal state (released, refunded, partially refunded; Unit 2's events) becomes
//    rateable for the CP-39 window (14 days): trust.rating_eligibility, once per order. Released ones count as
//    completed transactions; refunded ones can be rated but do not count.
//  - The buyer and the seller rate each other once, 1 to 5 stars with optional text. A rating can be edited for the
//    CP-39 edit period (48 hours) and is then fixed. The rated user may post one reply to a written review. An
//    operator may remove a review that breaks the content policy, with a reason; it then no longer counts.
//    The database enforces all of this too (trust.rating_guard); the service answers with readable problems first.
//  - GET /users/{id}/trust: the summary (trust.profile_summary) and badges; the reviews are paged separately.

const PAGE = 20;
const TERMINAL: Record<string, boolean> = { 'orders.escrow.released': true, 'orders.escrow.refunded': false, 'orders.escrow.partially_refunded': false };

interface RatingRow {
  id: string; order_id: string; rater_id: string; ratee_id: string; stars: number; text: string | null; created_at: Date; edit_until: Date;
  edited_at: Date | null; reply_text: string | null; reply_at: Date | null; removed_at: Date | null;
}

export interface RatingView {
  id: string; orderId: string; stars: number; text: string | null; createdAt: string; editableUntil: string; editedAt: string | null;
  reply: { text: string; at: string } | null;
}

export interface PublicReview {
  id: string; stars: number; text: string | null; at: string; edited: boolean;
  /** The rater's role in the order. */
  by: 'buyer' | 'seller';
  /** null: the rater closed their account ("Closed account"). */
  rater: { displayName: string } | null;
  reply: { text: string; at: string } | null;
}

const clean = (t: string | null | undefined) => t?.normalize('NFC').trim() || null;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

@Injectable()
export class RatingService implements TrustQuery {
  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** orders.escrow.released, .refunded, .partially_refunded: the order can be rated (once per order, DC-6). */
  async onEscrowClosed(e: OutboxEvent): Promise<boolean> {
    const p = e.payload as { orderId?: string; buyerId?: string; sellerId?: string };
    if (!(e.type in TERMINAL)) return false;
    if (!p.buyerId || !p.sellerId) throw new Error(`${e.type} ${e.id}: no buyerId or sellerId`); // retried, then reported (K-04)
    const window = (await this.params.current()).get<{ window: string }>('CP-39').window;
    const rows = (await this.db.query(
      `INSERT INTO trust.rating_eligibility (order_id, buyer_id, seller_id, closed_at, rate_until, completed)
       VALUES ($1, $2, $3, $4, $4::timestamptz + $5::interval, $6) ON CONFLICT (order_id) DO NOTHING RETURNING order_id`,
      [p.orderId ?? e.aggregateId, p.buyerId, p.sellerId, e.createdAt, window, TERMINAL[e.type]],
    )) as unknown[];
    return rows.length > 0;
  }

  /** POST /orders/{id}/rating (FR-REV-01, FR-REV-02): the buyer or the seller rates the other, once. */
  async rate(userId: string, orderId: string, r: { stars: number; text?: string | null }): Promise<RatingView> {
    const [e] = (await this.db.query(`SELECT buyer_id, seller_id, rate_until FROM trust.rating_eligibility WHERE order_id = $1`, [orderId])) as {
      buyer_id: string; seller_id: string; rate_until: Date;
    }[];
    // not paid, not finished, or not a party: there is nothing to rate (SEC-SDL-09: no hint which)
    if (!e || (e.buyer_id !== userId && e.seller_id !== userId)) throw new Problem('not-found');
    if (this.clock.now() > e.rate_until) throw new Problem('validation-failed', { errors: [{ field: 'order', reason: 'rating-window-ended' }] });
    const ratee = e.buyer_id === userId ? e.seller_id : e.buyer_id;
    const edit = (await this.params.current()).get<{ edit: string }>('CP-39').edit;
    try {
      const [row] = (await this.db.query(
        `INSERT INTO trust.ratings (order_id, rater_id, ratee_id, stars, text, edit_until) VALUES ($1, $2, $3, $4, $5, now() + $6::interval) RETURNING *`,
        [orderId, userId, ratee, r.stars, clean(r.text), edit],
      )) as RatingRow[];
      return this.view(row);
    } catch (err) {
      const code = err instanceof QueryFailedError ? (err.driverError as { code?: string }).code : undefined;
      if (code === '23505') throw new Problem('validation-failed', { errors: [{ field: 'order', reason: 'already-rated' }] });
      if (code === '23514') throw new Problem('validation-failed', { errors: [{ field: 'order', reason: 'rating-window-ended' }] }); // at the boundary
      throw err;
    }
  }

  /** PATCH /ratings/{id} (FR-REV-03): the rater, within the edit period. */
  async edit(userId: string, ratingId: string, r: { stars?: number; text?: string | null }): Promise<RatingView> {
    const row = await this.find(ratingId);
    if (row.rater_id !== userId || row.removed_at) throw new Problem('not-found');
    if (this.clock.now() > row.edit_until) throw new Problem('validation-failed', { errors: [{ field: 'rating', reason: 'edit-period-ended' }] });
    const text = r.text === undefined ? row.text : clean(r.text);
    if (row.reply_text && !text) throw new Problem('validation-failed', { errors: [{ field: 'text', reason: 'has-a-reply' }] }); // the reply answers it
    try {
      const [updated] = (await this.db.query(`UPDATE trust.ratings SET stars = $2, text = $3 WHERE id = $1 RETURNING *`, [ratingId, r.stars ?? row.stars, text])) as [RatingRow[], number];
      return this.view(updated[0]);
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23514') {
        throw new Problem('validation-failed', { errors: [{ field: 'rating', reason: 'edit-period-ended' }] });
      }
      throw err;
    }
  }

  /** POST /ratings/{id}/reply (FR-REV-06): the rated user, once, to a written review. */
  async reply(userId: string, ratingId: string, text: string): Promise<RatingView> {
    const row = await this.find(ratingId);
    if (row.ratee_id !== userId || row.removed_at) throw new Problem('not-found');
    if (!row.text) throw new Problem('validation-failed', { errors: [{ field: 'rating', reason: 'no-text-to-answer' }] });
    if (row.reply_text) throw new Problem('validation-failed', { errors: [{ field: 'rating', reason: 'already-replied' }] });
    const reply = clean(text);
    if (!reply) throw new Problem('validation-failed', { errors: [{ field: 'text', reason: 'empty' }] });
    const [updated] = (await this.db.query(
      `UPDATE trust.ratings SET reply_text = $2, reply_at = now() WHERE id = $1 AND reply_text IS NULL RETURNING *`, [ratingId, reply],
    )) as [RatingRow[], number];
    if (!updated.length) throw new Problem('validation-failed', { errors: [{ field: 'rating', reason: 'already-replied' }] });
    return this.view(updated[0]);
  }

  /** POST /staff/ratings/{id}/removal (FR-REV-07): with a reason; the review no longer counts. Audited. */
  async remove(staffId: string, ratingId: string, reason: string, ctx: CallContext = {}): Promise<{ ratingId: string; removed: true }> {
    const why = reason.normalize('NFC').trim();
    if (why.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    await this.db.transaction(async (m) => {
      const [updated] = (await m.query(
        `UPDATE trust.ratings SET removed_at = now(), removed_by = $2, removal_reason = $3 WHERE id = $1 AND removed_at IS NULL RETURNING ratee_id`,
        [ratingId, staffId, why],
      )) as [{ ratee_id: string }[], number];
      if (!updated.length) throw new Problem('not-found');
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'trust.rating.removed', objectType: 'rating', objectId: ratingId,
        after: { rateeId: updated[0].ratee_id }, reason: why, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
      }, m);
    });
    return { ratingId, removed: true };
  }

  /** TrustQuery (Units 3 and 8), FR-REV-04: removed reviews do not count; refunded orders are not completed. */
  async profileSummary(userId: string): Promise<ProfileSummary> {
    const [s] = (await this.db.query(
      `SELECT average_rating::float8 AS average, rating_count::int AS n, completed_transactions::int AS done FROM trust.profile_summary WHERE user_id = $1`, [userId],
    )) as { average: number | null; n: number; done: number }[];
    return { averageRating: s?.average ?? null, ratingCount: s?.n ?? 0, completedTransactions: s?.done ?? 0 };
  }

  /** GET /users/{id}/trust (FR-REV-04, FR-REV-05). The Pro badge comes with Unit 2's Pro subscription (U2-06). */
  async trust(userId: string) {
    const profile = await this.identity.getPublicProfile(userId); // not-found for an unknown user
    return { userId, ...(await this.profileSummary(userId)), badges: { verified: profile.verified, pro: false } };
  }

  /** GET /users/{id}/ratings: the reviews a user received, newest first, without removed ones. */
  async reviews(userId: string, cursor?: string): Promise<{ items: PublicReview[]; nextCursor: string | null }> {
    const [at, id] = cursor ? decodeCursor(cursor) : [null, null];
    const rows = (await this.db.query(
      `SELECT r.*, e.buyer_id, r.created_at::text AS at_text FROM trust.ratings r JOIN trust.rating_eligibility e ON e.order_id = r.order_id
        WHERE r.ratee_id = $1 AND r.removed_at IS NULL AND ($2::timestamptz IS NULL OR (r.created_at, r.id) < ($2, $3::uuid))
        ORDER BY r.created_at DESC, r.id DESC LIMIT ${PAGE + 1}`,
      [userId, at, id],
    )) as (RatingRow & { buyer_id: string; at_text: string })[];
    const page = rows.slice(0, PAGE);
    const items = await Promise.all(page.map(async (r): Promise<PublicReview> => {
      const rater = await this.identity.getPrincipal(r.rater_id).catch(() => null);
      return {
        id: r.id, stars: r.stars, text: r.text, at: r.created_at.toISOString(), edited: r.edited_at !== null,
        by: r.rater_id === r.buyer_id ? 'buyer' : 'seller',
        rater: rater && rater.accountStatus !== 'closed' ? { displayName: rater.displayName } : null,
        reply: r.reply_text && r.reply_at ? { text: r.reply_text, at: r.reply_at.toISOString() } : null,
      };
    }));
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > PAGE && last ? encodeCursor(last.at_text, last.id) : null };
  }

  private async find(id: string): Promise<RatingRow> {
    const [r] = (await this.db.query(`SELECT * FROM trust.ratings WHERE id = $1`, [id])) as RatingRow[];
    if (!r) throw new Problem('not-found');
    return r;
  }

  private view(r: RatingRow): RatingView {
    return {
      id: r.id, orderId: r.order_id, stars: r.stars, text: r.text, createdAt: r.created_at.toISOString(), editableUntil: r.edit_until.toISOString(),
      editedAt: iso(r.edited_at), reply: r.reply_text && r.reply_at ? { text: r.reply_text, at: r.reply_at.toISOString() } : null,
    };
  }
}

/** The database's own text of created_at (microseconds, which a JavaScript Date would lose) and the id. */
function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`).toString('base64url');
}
function decodeCursor(c: string): [string, string] {
  const [at, id] = Buffer.from(c, 'base64url').toString().split('|');
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/.test(at ?? '') || !/^[0-9a-f-]{36}$/.test(id ?? '')) {
    throw new Problem('validation-failed', { errors: [{ field: 'cursor', reason: 'invalid' }] });
  }
  return [at, id];
}
