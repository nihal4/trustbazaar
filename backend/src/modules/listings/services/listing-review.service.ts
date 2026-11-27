import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, CallContext, IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { publish } from './outbox';
import { ListingCommandsService } from './listing-commands.service';
import { ListingService } from './listing.service';

// The operators' side of listings (docs/design/03_listings_auctions.pdf sections 3.1 and 5; FR-LST-11, FR-LST-12,
// FR-SRC-04, FR-TNS-05, I-45; U3-08): ListingReviewService.
//  - Review: a listing held by the screening terms is approved (published) or returned to its seller as a draft, with a
//    reason. A game account is approved only through Unit 5's ownership review (its approval takes the player-ID claim).
//  - Removal for a policy breach, with a reason (an open auction is cancelled with it).
//  - The screening terms: added and deleted by operators.
//  - Visibility (I-45): when a seller's KYC, account or sanctions change, their listings are hidden or shown again
//    (seller_visible), recomputed from Unit 1's answer to "may this user list?", so the events' order does not matter.
// Every decision is audited; the seller is told through listings.listing.returned and .removed (Unit 6).

const VISIBILITY_EVENTS = [
  'identity.kyc.verified',
  'identity.kyc.revoked',
  'identity.account.suspended',
  'identity.account.reinstated',
  'trust.sanction.applied',
  'trust.sanction.lifted',
];
const reasonOf = (raw: string) => {
  const r = raw.normalize('NFC').trim();
  if (r.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
  return r;
};

@Injectable()
export class ListingReviewService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly commands: ListingCommandsService,
    private readonly bus: EventBus,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    private readonly listings?: ListingService,
  ) {}

  /** Re-screens a seller's listings when something changes that decides their visibility (a subscription to those events). */
  onModuleInit(): void {
    for (const type of VISIBILITY_EVENTS) this.bus.on(type, 'listings.visibility', (e) => this.onSellerChanged(e).then(() => undefined));
  }

  /** POST /staff/listings/{id}/review (FR-LST-11): approve, or return to the seller with the reason. */
  async review(
    staffId: string,
    listingId: string,
    decision: 'approve' | 'return',
    rawReason: string,
    ctx: CallContext = {},
  ): Promise<{ status: 'active' | 'draft' }> {
    const reason = reasonOf(rawReason);
    return this.db.transaction(async (m) => {
      const [l] = (await m.query(`SELECT seller_id, item_kind, title FROM listings.listings WHERE id = $1`, [listingId])) as {
        seller_id: string;
        item_kind: string;
        title: string;
      }[];
      if (!l) throw new Problem('not-found');
      if (l.item_kind === 'game_account') throw new Problem('listing-state', { errors: [{ field: 'listing', reason: 'use-the-ownership-review' }] }); // Unit 5
      if (decision === 'approve') await this.commands.approveForPublication(listingId, staffId, reason, m);
      else {
        if (!(await this.commands.returnToDraft(listingId, staffId, reason, m))) throw new Problem('listing-state');
        await publish(m, 'listings.listing.returned', listingId, { listingId, sellerId: l.seller_id, reason });
      }
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staffId,
          action: decision === 'approve' ? 'listings.listing.approved' : 'listings.listing.returned',
          objectType: 'listing',
          objectId: listingId,
          reason,
          sourceIp: ctx.ip ?? null,
          correlationId: ctx.correlationId ?? null,
        },
        m,
      );
      return { status: decision === 'approve' ? 'active' : 'draft' };
    });
  }

  /**
   * GET /staff/listings/{id} (FR-LST-11, FR-LST-12; Decisions log, U8-10): the listing as its seller sees it, in any
   * state, for the operator deciding a review or a removal; without the seller's own area and the reserve price
   * (SEC-ACC-05). Each read is audited.
   */
  async staffView(staffId: string, listingId: string, ctx: CallContext = {}) {
    const [l] = (await this.db.query(`SELECT seller_id FROM listings.listings WHERE id = $1`, [listingId])) as { seller_id: string }[];
    if (!l || !this.listings) throw new Problem('not-found');
    const view = (await this.listings.view(listingId, { userId: l.seller_id })) as Record<string, unknown> & { auction: Record<string, unknown> | null };
    await this.db.transaction((m) =>
      this.audit.record(
        {
          actorType: 'staff',
          actorId: staffId,
          action: 'listings.listing.staff_viewed',
          objectType: 'listing',
          objectId: listingId,
          sourceIp: ctx.ip ?? null,
          correlationId: ctx.correlationId ?? null,
        },
        m,
      ),
    );
    const { own: _own, auction, ...rest } = view;
    void _own;
    return { ...rest, auction: auction && Object.fromEntries(Object.entries(auction).filter(([k]) => k !== 'reservePrice')) };
  }

  /** POST /staff/listings/{id}/remove (FR-LST-12): for a policy breach, with the reason. */
  async remove(staffId: string, listingId: string, rawReason: string, ctx: CallContext = {}): Promise<{ status: 'removed' }> {
    const reason = reasonOf(rawReason);
    await this.db.transaction(async (m) => {
      await this.commands.remove(listingId, staffId, reason, m);
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staffId,
          action: 'listings.listing.removed',
          objectType: 'listing',
          objectId: listingId,
          reason,
          sourceIp: ctx.ip ?? null,
          correlationId: ctx.correlationId ?? null,
        },
        m,
      );
    });
    return { status: 'removed' };
  }

  /** GET /staff/screening-terms. */
  async terms() {
    const rows = (await this.db.query(`SELECT id, term, severity, added_by, added_at FROM listings.screening_terms ORDER BY term`)) as {
      id: number;
      term: string;
      severity: string;
      added_by: string | null;
      added_at: Date;
    }[];
    return { items: rows.map((r) => ({ id: r.id, term: r.term, severity: r.severity, addedBy: r.added_by, addedAt: r.added_at.toISOString() })) };
  }

  /** POST /staff/screening-terms (FR-LST-11): lower case, Bangla or English; applies to listings published from now on. */
  async addTerm(
    staffId: string,
    rawTerm: string,
    severity: 'prohibited' | 'high_risk',
    ctx: CallContext = {},
  ): Promise<{ id: number; term: string; severity: string }> {
    const term = rawTerm.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
    if (term.length < 2 || term.length > 80) throw new Problem('validation-failed', { errors: [{ field: 'term', reason: 'length' }] });
    try {
      return await this.db.transaction(async (m) => {
        const [r] = (await m.query(`INSERT INTO listings.screening_terms (term, severity, added_by) VALUES ($1, $2, $3) RETURNING id`, [
          term,
          severity,
          staffId,
        ])) as { id: number }[];
        await this.audit.record(
          {
            actorType: 'staff',
            actorId: staffId,
            action: 'listings.screening_term.added',
            objectType: 'screening_term',
            objectId: null,
            after: { id: r.id, term, severity },
            sourceIp: ctx.ip ?? null,
            correlationId: ctx.correlationId ?? null,
          },
          m,
        );
        return { id: r.id, term, severity };
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505')
        throw new Problem('validation-failed', { errors: [{ field: 'term', reason: 'taken' }] });
      throw err;
    }
  }

  /** DELETE /staff/screening-terms/{id}. */
  async deleteTerm(staffId: string, id: number, ctx: CallContext = {}): Promise<void> {
    await this.db.transaction(async (m) => {
      const [[t]] = (await m.query(`DELETE FROM listings.screening_terms WHERE id = $1 RETURNING term, severity`, [id])) as [
        { term: string; severity: string }[],
        number,
      ];
      if (!t) throw new Problem('not-found');
      await this.audit.record(
        {
          actorType: 'staff',
          actorId: staffId,
          action: 'listings.screening_term.deleted',
          objectType: 'screening_term',
          objectId: null,
          before: { id, term: t.term, severity: t.severity },
          sourceIp: ctx.ip ?? null,
          correlationId: ctx.correlationId ?? null,
        },
        m,
      );
    });
  }

  /** I-45: the seller's listings are visible exactly while Unit 1 lets them list. Returns the listings changed. */
  async onSellerChanged(e: OutboxEvent): Promise<number> {
    const userId = typeof e.payload.userId === 'string' ? e.payload.userId : e.aggregateId;
    let visible = true;
    try {
      await this.identity.assertCanTransact(userId, 'list');
    } catch (err) {
      if (!(err instanceof Problem && err.problem === 'transaction-not-allowed')) throw err;
      visible = false;
    }
    const [, n] = (await this.db.query(`UPDATE listings.listings SET seller_visible = $2 WHERE seller_id = $1 AND seller_visible <> $2`, [
      userId,
      visible,
    ])) as [unknown, number];
    return n;
  }
}
