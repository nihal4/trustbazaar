import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { TbConfig } from '../../../kernel/config/config';
import { TB_CONFIG } from '../../../kernel/config/config.provider';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { deviceDigest } from '../../../kernel/device-identifier';
import { SanctionService } from './sanction.service';
import type { OutboxEvent } from '../../../kernel/events/event-bus';
import { disputeOfKey, recordMessage } from './dispute-messages';
import { Problem } from '../../../kernel/http/problems';
import type { Principal } from '../../../kernel/http/principal';
import { CHAT_COMMANDS, ChatCommands, NOTIFIER, Notifier } from '../../chat/ports';
import { DELIVERY_COMMANDS, DELIVERY_QUERIES, DeliveryCommands, DeliveryQueries } from '../../delivery/ports';
import {
  Approval, APPROVAL_SERVICE, ApprovalServicePort, AUDIT_SERVICE, AuditServicePort, CallContext, FILE_VAULT, FileVaultPort, IDENTITY_QUERY, IdentityQuery,
  STAFF_QUERY, StaffQuery,
} from '../../identity/ports';
import { GAME_ACCOUNT_QUERIES, GameAccountQueries } from '../../game-accounts/ports';
import { ESCROW_COMMANDS, ESCROW_QUERY, EscrowCommands, EscrowQuery, ORDERS_PORT, OrdersPort } from '../../orders/ports';

// Disputes on physical goods, the operator's side (docs/design/07_disputes_trust_staff.pdf sections 5.4 to 5.6; FR-DSP-05
// to FR-DSP-09, FR-OPS-06, CP-30; U7-03, second part).
//  - An operator claims a dispute (Unit 1's conflict check against both parties); only that operator opens the case
//    file, asks the seller for more (DV-47: 24 hours) and decides. Every view of the case file is audited.
//  - The decision is one of FR-DSP-06's four outcomes with a reason the parties see. It runs in one transaction: the
//    order is locked (DC-14), disputes.decide (which records the seller's strike for any outcome but release), then
//    Unit 2's applyDisputeOutcome; for (d) the return shipment is booked with Unit 4 first (courier orders) and the
//    dispute waits for the item. On BDT 20,000 or more (CP-30, on the amount collected) the decision is proposed for
//    four-eyes approval instead, and the approval's handler runs it.
//  - disputes.dispute.decided (published by disputes.decide) releases the chat hold and tells both parties, after the
//    decision's commit, whichever way it was decided.
//  - Outcome (d) completes when Unit 4 reports the return delivered, or the seller records receipt: the refund follows.

export type DecisionOutcome = 'release' | 'full_refund' | 'partial_refund' | 'refund_after_return';
export interface Decision { outcome: DecisionOutcome; reason: string; itemRefund?: string; returnPayer?: 'buyer' | 'seller' }

const FOUR_EYES_POISHA = 2_000_000n; // CP-30: BDT 20,000, on the amount collected
const LIVE = ['open', 'under_review', 'awaiting_seller', 'awaiting_return'];

interface CaseRow {
  id: string; order_id: string; buyer_id: string; seller_id: string; item_kind: string; type: string; description: string; status: string; amount_collected: string;
  item_price: string; assigned_to: string | null; opened_at: Date; seller_due_at: Date; info_due_at: Date | null; review_started_at: Date | null;
  decision_target_at: Date | null; outcome: string | null; item_refund: string | null; return_fare: string | null; return_fare_payer: string | null;
  decision_reason: string | null; decided_at: Date | null;
}

function problemOf(err: unknown): Problem | null {
  if (!(err instanceof QueryFailedError)) return null;
  const { code, message } = err.driverError as { code?: string; message?: string };
  const reason = (r: string) => new Problem('validation-failed', { errors: [{ field: 'dispute', reason: r }] });
  if (code === '42501') return new Problem('not-claimed');
  if (code !== '23514') return null;
  if (message?.includes('assigned to another operator')) return new Problem('already-claimed');
  if (message?.includes('not under review') || message?.includes('dispute is closed') || message?.includes('not awaiting a return')) return reason('not-in-this-state');
  if (message?.includes('only the assigned operator can ask')) return new Problem('not-claimed');
  if (message?.includes('four-eyes')) return new Problem('four-eyes-required');
  return null;
}

@Injectable()
export class DisputeCaseService implements OnModuleInit {
  private readonly log = new Logger('DisputeCases');

  constructor(
    private readonly db: DataSource,
    @Inject(ORDERS_PORT) private readonly orders: OrdersPort,
    @Inject(ESCROW_QUERY) private readonly escrowQuery: EscrowQuery,
    @Inject(ESCROW_COMMANDS) private readonly escrow: EscrowCommands,
    @Inject(DELIVERY_QUERIES) private readonly deliveryQuery: DeliveryQueries,
    @Inject(DELIVERY_COMMANDS) private readonly delivery: DeliveryCommands,
    @Inject(CHAT_COMMANDS) private readonly chat: ChatCommands,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(STAFF_QUERY) private readonly staff: StaffQuery,
    @Inject(APPROVAL_SERVICE) private readonly approvals: ApprovalServicePort,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(GAME_ACCOUNT_QUERIES) private readonly games: GameAccountQueries,
    @Inject(TB_CONFIG) private readonly config: TbConfig,
    private readonly sanctions: SanctionService,
  ) {}

  onModuleInit(): void {
    // CP-30: the second operator's approval runs the proposed decision, in the approval's transaction
    this.approvals.registerHandler('dispute.outcome_20000', (a, tx) => this.decideApproved(a, tx));
  }

  /** POST /staff/cases/dispute/{id}/claim (FR-OPS-06). */
  async claim(staffId: string, disputeId: string, ctx: CallContext = {}): Promise<{ disputeId: string; status: string }> {
    const d = await this.find(this.db.manager, disputeId);
    if (!LIVE.includes(d.status)) throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'not-in-this-state' }] });
    if (d.assigned_to && d.assigned_to !== staffId) throw new Problem('already-claimed');
    await this.staff.assertNoConflict(staffId, [d.buyer_id, d.seller_id]);
    try {
      await this.db.transaction(async (m) => {
        await m.query(`SELECT disputes.assign($1, $2)`, [disputeId, staffId]);
        await this.audit.record({ actorType: 'staff', actorId: staffId, action: 'disputes.dispute.claimed', objectType: 'dispute', objectId: disputeId, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null }, m);
      });
    } catch (err) {
      throw problemOf(err) ?? err;
    }
    return { disputeId, status: d.status };
  }

  /** GET /staff/disputes/{id}/case-file (FR-DSP-05): the assigned operator only; each view audited (SEC-LOG-01). */
  async caseFile(staff: Principal & { type: 'staff' }, disputeId: string, ctx: CallContext = {}) {
    const d = await this.assigned(staff.staffId, disputeId);
    await this.db.transaction((m) => this.audit.record({
      actorType: 'staff', actorId: staff.staffId, action: 'disputes.case_file.viewed', objectType: 'dispute', objectId: disputeId, sourceIp: ctx.ip ?? null, correlationId: ctx.correlationId ?? null,
    }, m));
    const reason = `Evidence of dispute ${disputeId}`;
    const [order, escrow, preview, fulfilment, history, statements, evidence, earlier, strikes, sanctions, buyer, seller] = await Promise.all([
      this.orders.getOrderForParty(d.order_id, d.buyer_id),
      this.escrowQuery.getEscrow(d.order_id),
      this.escrowQuery.previewOutcomes(d.order_id),
      this.deliveryQuery.fulfilmentRecord(d.order_id),
      this.db.query(`SELECT from_status, to_status, actor, reason, at FROM disputes.history WHERE dispute_id = $1 ORDER BY id`, [disputeId]) as Promise<{ from_status: string | null; to_status: string; actor: string; reason: string | null; at: Date }[]>,
      this.db.query(`SELECT party, text, at FROM disputes.statements WHERE dispute_id = $1 ORDER BY id`, [disputeId]) as Promise<{ party: string; text: string | null; at: Date }[]>,
      this.db.query(`SELECT id, party, storage_key, mime, byte_size, at FROM disputes.evidence WHERE dispute_id = $1 ORDER BY at`, [disputeId]) as Promise<{ id: string; party: string; storage_key: string | null; mime: string; byte_size: number; at: Date }[]>,
      this.db.query(
        `SELECT id, order_id, type, status, outcome, buyer_id = $2 AS as_buyer, opened_at FROM disputes.disputes
          WHERE id <> $1 AND (buyer_id IN ($2, $3) OR seller_id IN ($2, $3)) ORDER BY opened_at DESC LIMIT 20`, [disputeId, d.buyer_id, d.seller_id],
      ) as Promise<{ id: string; order_id: string; type: string; status: string; outcome: string | null; as_buyer: boolean; opened_at: Date }[]>,
      this.db.query(`SELECT user_id, reason, order_id, at FROM trust.strikes WHERE user_id IN ($1, $2) ORDER BY at DESC LIMIT 20`, [d.buyer_id, d.seller_id]) as Promise<{ user_id: string; reason: string; order_id: string; at: Date }[]>,
      this.db.query(`SELECT user_id, kind, reason, starts_at, ends_at, lifted_at FROM trust.sanctions WHERE user_id IN ($1, $2) ORDER BY starts_at DESC LIMIT 20`, [d.buyer_id, d.seller_id]) as Promise<{ user_id: string; kind: string; reason: string; starts_at: Date; ends_at: Date | null; lifted_at: Date | null }[]>,
      this.identity.getPublicProfile(d.buyer_id).catch(() => null),
      this.identity.getPublicProfile(d.seller_id).catch(() => null),
    ]);
    const who = (id: string) => (id === d.buyer_id ? 'buyer' : 'seller');
    const iso = (x: Date | null) => (x ? x.toISOString() : null);
    const thread = await this.chat.threadFor(order.listing.id, d.buyer_id);
    const game = d.item_kind === 'game_account' ? await this.gameEvidence(d.order_id, staff, reason, ctx, who) : null;
    // U10-23 (FR-TNS-10): the seller's return check, whether an operator may close a stuck return, and which buyer findings may still be recorded
    const checks = (await this.db.query(`SELECT matched, at FROM disputes.return_checks WHERE dispute_id = $1 ORDER BY id`, [disputeId])) as { matched: boolean; at: Date }[];
    const [finding] = (await this.db.query(`SELECT finding, reason, at FROM disputes.buyer_findings WHERE dispute_id = $1`, [disputeId])) as { finding: string; reason: string; at: Date }[];
    const [{ outcome }] = (await this.db.query(`SELECT outcome FROM disputes.disputes WHERE id = $1`, [disputeId])) as { outcome: string | null }[];
    const mismatch = checks.some((c) => !c.matched);
    const overdue = d.decision_target_at !== null && d.decision_target_at.getTime() < Date.now();
    const findings: string[] = d.status !== 'decided' || d.item_kind === 'game_account' || finding ? [] : [...(outcome === 'release' ? ['false_claim'] : []), ...(mismatch ? ['swap'] : [])];
    return {
      returnCheck: {
        checks: checks.map((c) => ({ matched: c.matched, at: c.at.toISOString() })),
        canResolve: d.status === 'awaiting_return' && (mismatch || overdue),
        finding: finding ? { finding: finding.finding, reason: finding.reason, at: finding.at.toISOString() } : null,
        findings,
      },
      dispute: {
        id: d.id, type: d.type, status: d.status, description: d.description, openedAt: d.opened_at.toISOString(), sellerDueAt: d.seller_due_at.toISOString(),
        infoDueAt: iso(d.info_due_at), reviewStartedAt: iso(d.review_started_at), decisionTargetAt: iso(d.decision_target_at),
        fourEyes: BigInt(d.amount_collected) >= FOUR_EYES_POISHA,
      },
      // SEC-ACC-05: names as shown publicly; contact details and addresses stay masked (Unit 4's record masks addresses)
      parties: { buyer: buyer && { displayName: buyer.displayName, verified: buyer.verified }, seller: seller && { displayName: seller.displayName, verified: seller.verified } },
      order: {
        id: order.id, kind: order.kind, status: order.status, listing: order.listing, itemPrice: order.itemPrice, deliveryFee: order.deliveryFee, total: order.total,
        fulfilment: order.fulfilment, paidAt: order.paidAt, fulfilmentDueAt: order.fulfilmentDueAt, deliveryEventAt: order.deliveryEventAt,
      },
      escrow: { state: escrow.state, amountCollected: escrow.amountCollected, disputeWindowEndsAt: iso(escrow.disputeWindowEndsAt), autoReleaseAt: iso(escrow.autoReleaseAt) },
      outcomes: preview,
      fulfilment,
      game, // FR-DSP-05: Unit 5's evidence for a game account; never the credentials
      chat: thread ? { threadId: thread, path: `/staff/cases/dispute/${disputeId}/threads/${thread}` } : null,
      history: history.map((h) => ({ from: h.from_status, to: h.to_status, actor: h.actor, reason: h.reason, at: h.at.toISOString() })),
      statements: statements.map((s) => ({ party: s.party, text: s.text, at: s.at.toISOString() })),
      // U10-23: the seller's photos of the item at the meetup, with the time the server received them (null link once purged)
      handoverPhotos: await this.handoverPhotos(d.order_id, staff, reason, ctx),
      evidence: await Promise.all(evidence.map(async (e) => ({
        id: e.id, party: e.party, mime: e.mime, size: e.byte_size, at: e.at.toISOString(), link: e.storage_key ? await this.vault.signedLink(e.storage_key, staff, reason, ctx) : null,
      }))),
      context: {
        disputes: earlier.map((x) => ({ id: x.id, orderId: x.order_id, type: x.type, status: x.status, outcome: x.outcome, buyerHere: x.as_buyer ? 'buyer' : 'seller', openedAt: x.opened_at.toISOString() })),
        strikes: strikes.map((x) => ({ party: who(x.user_id), reason: x.reason, orderId: x.order_id, at: x.at.toISOString() })),
        sanctions: sanctions.map((x) => ({ party: who(x.user_id), kind: x.kind, reason: x.reason, startsAt: x.starts_at.toISOString(), endsAt: iso(x.ends_at), liftedAt: iso(x.lifted_at) })),
      },
    };
  }

  /**
   * GET /staff/disputes/{id}/outcome-preview?itemRefund= (FR-DSP-06; Decisions log, U8-10): Unit 2's exact split for a
   * partial refund of that amount, for the assigned operator, so the decision form shows it before deciding. Only an
   * amount strictly between 0 and the item price is a partial refund.
   */
  async outcomePreview(staffId: string, disputeId: string, itemRefund: string) {
    const d = await this.assigned(staffId, disputeId);
    const preview = await this.escrowQuery.previewOutcomes(d.order_id, BigInt(itemRefund));
    if (!preview.partialRefund) throw new Problem('validation-failed', { errors: [{ field: 'itemRefund', reason: 'out-of-range' }] });
    return preview;
  }

  /** Unit 5's evidence for the case file: the screenshot by a signed link, the addresses masked to their network (SEC-ACC-05). */
  private async gameEvidence(orderId: string, staff: Principal & { type: 'staff' }, reason: string, ctx: CallContext, who: (id: string) => string) {
    const g = await this.games.evidence(orderId);
    if (!g) return null;
    const iso = (x: Date | null) => (x ? x.toISOString() : null);
    const { screenshotKey, ...proof } = g.proof ?? { screenshotKey: null };
    return {
      details: g.details,
      proof: g.proof ? {
        ...proof, submittedAt: iso(g.proof.submittedAt), reviewedAt: iso(g.proof.reviewedAt),
        screenshot: screenshotKey ? await this.vault.signedLink(screenshotKey, staff, reason, ctx) : null, // null once purged (DV-39)
      } : null,
      handover: Object.fromEntries(Object.entries(g.handover).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])),
      confirmations: g.confirmations.map((c) => ({ step: c.step, at: c.at.toISOString(), sessionId: c.sessionId })),
      accessLog: g.accessLog.map((a) => ({ at: a.at.toISOString(), party: who(a.userId), sessionId: a.sessionId, keyVersion: a.keyVersion, network: maskIp(a.sourceIp) })),
    };
  }

  /** POST /staff/disputes/{id}/request-info (FR-DSP-09): the seller has DV-47 (24 hours) to answer. */
  async requestInfo(staffId: string, disputeId: string, note: string): Promise<{ status: string; infoDueAt: string }> {
    const text = note.normalize('NFC').trim();
    if (text.length < 10) throw new Problem('validation-failed', { errors: [{ field: 'note', reason: 'too-short' }] });
    const d = await this.assigned(staffId, disputeId);
    try {
      await this.db.query(`SELECT disputes.request_info($1, $2, interval '24 hours', $3)`, [disputeId, staffId, text]);
    } catch (err) {
      throw problemOf(err) ?? err;
    }
    const [{ info_due_at }] = (await this.db.query(`SELECT info_due_at FROM disputes.disputes WHERE id = $1`, [disputeId])) as { info_due_at: Date }[];
    const view = await this.orders.getOrderForParty(d.order_id, d.seller_id);
    await this.tell(d.seller_id, 'dispute.info_requested', { listing_title: view.listing.title, hours: 24 }, `dispute:${disputeId}:info:${info_due_at.toISOString()}`, { note: text.slice(0, 1000) }); // the operator's question is in the chat, not in the notice
    return { status: 'awaiting_seller', infoDueAt: info_due_at.toISOString() };
  }

  /**
   * POST /staff/disputes/{id}/decision (FR-DSP-06): decided at once, or proposed for four-eyes approval (CP-30), in
   * which case the dispute stays under review (and the buyer may still withdraw) until a second operator approves.
   */
  async decide(staffId: string, disputeId: string, dec: Decision, ctx: CallContext = {}): Promise<{ status: string; approvalId?: string }> {
    const d = await this.assigned(staffId, disputeId);
    if (d.status !== 'under_review') throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'not-in-this-state' }] });
    this.validate(d, dec);
    // U10-23 (Decisions log): a meetup order whose code was entered is refunded only after the item is back (a swap or a self-inflicted fault then gains nothing)
    if (d.item_kind !== 'game_account' && (dec.outcome === 'full_refund' || dec.outcome === 'partial_refund')) {
      const order = await this.orders.getOrderForParty(d.order_id, d.buyer_id);
      if (order.fulfilment === 'self_pickup' && order.deliveryEventAt !== null) throw new Problem('validation-failed', { errors: [{ field: 'outcome', reason: 'return-first' }] });
    }
    if (BigInt(d.amount_collected) >= FOUR_EYES_POISHA) {
      const approval = await this.approvals.propose({
        action: 'dispute.outcome_20000', targetType: 'dispute', targetId: disputeId, reason: dec.reason, requiredRole: 'operator', byStaffId: staffId,
        payload: { outcome: dec.outcome, itemRefund: dec.itemRefund ?? null, returnPayer: dec.returnPayer ?? null, reason: dec.reason },
      }, ctx);
      return { status: 'proposed', approvalId: approval.id };
    }
    const status = await this.db.transaction((m) => this.execute(m, d, staffId, dec, null));
    return { status };
  }

  /** POST /disputes/{id}/return-received (outcome (d)): the seller records that the item is back. */
  async returnReceived(sellerId: string, disputeId: string): Promise<{ status: 'decided' }> {
    const [d] = (await this.db.query(`SELECT id, order_id, seller_id, status FROM disputes.disputes WHERE id = $1`, [disputeId])) as { id: string; order_id: string; seller_id: string; status: string }[];
    if (!d || d.seller_id !== sellerId) throw new Problem('not-found');
    if (d.status !== 'awaiting_return') throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'not-in-this-state' }] });
    // U10-23 (FR-TNS-10): an item with a device identifier is taken back only after the seller has checked it is the one sold
    if (await this.orders.deviceIdentifier(d.order_id)) {
      const [ok] = (await this.db.query(`SELECT 1 FROM disputes.return_checks WHERE dispute_id = $1 AND matched AND NOT EXISTS (SELECT 1 FROM disputes.return_checks x WHERE x.dispute_id = $1 AND NOT x.matched)`, [d.id])) as unknown[];
      if (!ok) throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'return-check-needed' }] });
    }
    await this.completeReturn(d.id, d.order_id);
    return { status: 'decided' };
  }

  /**
   * POST /disputes/{id}/return-check (U10-23, FR-TNS-10): the seller types the identifier of the item taken back; a mismatch is kept, opens a flagged-activity
   * signal for the operators, and blocks the seller's own return-received (only an operator can then close the dispute, see resolveReturn). Only the result is kept.
   */
  async returnCheck(sellerId: string, disputeId: string, typed: string): Promise<{ matched: boolean }> {
    const [d] = (await this.db.query(`SELECT id, order_id, seller_id, status FROM disputes.disputes WHERE id = $1`, [disputeId])) as { id: string; order_id: string; seller_id: string; status: string }[];
    if (!d || d.seller_id !== sellerId) throw new Problem('not-found');
    if (d.status !== 'awaiting_return') throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'not-in-this-state' }] });
    const id = await this.orders.deviceIdentifier(d.order_id);
    if (!id) throw new Problem('validation-failed', { errors: [{ field: 'value', reason: 'no-device' }] });
    // a mismatch is final: the seller cannot try other numbers until one fits; only an operator closes the dispute from there
    const [past] = (await this.db.query(`SELECT 1 FROM disputes.return_checks WHERE dispute_id = $1`, [d.id])) as unknown[];
    if (past) throw new Problem('validation-failed', { errors: [{ field: 'value', reason: 'already-checked' }] });
    const matched = deviceDigest(this.config.secrets.handoverKey.reveal(), typed).toString('hex') === id.digest;
    await this.db.query(`INSERT INTO disputes.return_checks (dispute_id, user_id, matched) VALUES ($1, $2, $3)`, [d.id, sellerId, matched]);
    if (!matched) {
      await this.db.query(
        `INSERT INTO trust.signals (kind, source_ref, subject_user, detail) VALUES ('return_mismatch', $1, $2, $3) ON CONFLICT (kind, source_ref) DO NOTHING`,
        [d.id, sellerId, JSON.stringify({ disputeId: d.id, orderId: d.order_id })],
      );
    }
    return { matched };
  }

  /**
   * POST /staff/disputes/{id}/resolve-return (U10-23, FR-TNS-10): the way out of `awaiting_return` for an operator, so a refund can never hang on the seller:
   * allowed when the seller's check found a mismatch, or the decision target has passed. `refund` completes the return (the buyer is refunded);
   * `release` rejects it (the returned item was not the item sold: the seller is paid). The assigned operator, with a reason; audited.
   */
  async resolveReturn(staffId: string, disputeId: string, outcome: 'refund' | 'release', reason: string, ctx: CallContext = {}): Promise<{ status: 'decided' }> {
    const text = reason.normalize('NFC').trim();
    if (text.length < 20) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    const d = await this.assigned(staffId, disputeId);
    if (d.status !== 'awaiting_return') throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'not-in-this-state' }] });
    const [bad] = (await this.db.query(`SELECT 1 FROM disputes.return_checks WHERE dispute_id = $1 AND NOT matched`, [disputeId])) as unknown[];
    const overdue = d.decision_target_at !== null && d.decision_target_at.getTime() < Date.now();
    if (!bad && !overdue) throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'return-not-stuck' }] });
    if (outcome === 'refund') {
      await this.completeReturn(d.id, d.order_id);
    } else {
      await this.db.transaction(async (m) => {
        await this.orders.lockForFulfilment(d.order_id, m); // DC-14
        await m.query(`SELECT disputes.return_rejected($1, $2)`, [d.id, staffId]);
        await this.escrow.applyDisputeOutcome(d.order_id, d.id, { kind: 'release' }, m);
      });
    }
    await this.audit.record({ actorType: 'staff', actorId: staffId, action: 'disputes.dispute.return_resolved', objectType: 'dispute', objectId: disputeId, after: { outcome }, reason: text }, this.db.manager);
    for (const user of [d.buyer_id, d.seller_id]) await recordMessage(this.db, disputeId, user, outcome === 'refund' ? 'dispute.return_refunded' : 'dispute.return_rejected', {}, `dispute:${disputeId}:return-resolved`);
    return { status: 'decided' };
  }

  /**
   * POST /staff/disputes/{id}/buyer-finding (U10-23, FR-TNS-10): an operator's finding that the buyer acted in bad faith. Only on a decided dispute of this
   * operator's case, once a dispute, with a reason; never for losing a dispute alone. `false_claim` needs the seller to have been paid in full (outcome
   * release); `swap` needs a return check that found the returned item was not the one sold. A finding gives a buyer strike; at two in 365 days, or
   * at once for a swap, buying and bidding are suspended pending review (a swap also goes to the operators as a blacklist review signal, FR-TNS-06).
   */
  async buyerFinding(staffId: string, disputeId: string, finding: 'false_claim' | 'swap', reason: string, ctx: CallContext = {}): Promise<{ strike: boolean; suspended: boolean }> {
    const text = reason.normalize('NFC').trim();
    if (text.length < 20) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    const d = await this.assigned(staffId, disputeId);
    if (d.status !== 'decided' || d.item_kind === 'game_account') throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'not-in-this-state' }] });
    const [out] = (await this.db.query(`SELECT outcome, last_reason FROM disputes.disputes WHERE id = $1`, [disputeId])) as { outcome: string | null; last_reason: string | null }[];
    if (finding === 'false_claim' && out.outcome !== 'release') throw new Problem('validation-failed', { errors: [{ field: 'finding', reason: 'seller-not-paid-in-full' }] });
    if (finding === 'swap') {
      const [bad] = (await this.db.query(`SELECT 1 FROM disputes.return_checks WHERE dispute_id = $1 AND NOT matched`, [disputeId])) as unknown[];
      if (!bad) throw new Problem('validation-failed', { errors: [{ field: 'finding', reason: 'no-return-mismatch' }] });
    }
    await this.staff.assertNoConflict(staffId, [d.buyer_id]);
    let suspended = false;
    try {
      await this.db.transaction(async (m) => {
        await m.query(`INSERT INTO disputes.buyer_findings (dispute_id, finding, staff_id, reason) VALUES ($1, $2, $3, $4)`, [disputeId, finding, staffId, text]);
        const [{ s }] = (await m.query(`SELECT trust.record_buyer_strike($1, $2::trust.strike_reason, $3, interval '365 days', 2) AS s`, [d.buyer_id, finding === 'swap' ? 'buyer_swap' : 'buyer_false_claim', d.order_id])) as { s: boolean }[];
        suspended = s;
        if (finding === 'swap') {
          await m.query(`INSERT INTO trust.signals (kind, source_ref, subject_user, detail) VALUES ('blacklist_review', $1, $2, $3) ON CONFLICT (kind, source_ref) DO NOTHING`, [disputeId, d.buyer_id, JSON.stringify({ disputeId, orderId: d.order_id, finding })]);
        }
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { code?: string }).code === '23505') throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'finding-exists' }] });
      throw err;
    }
    if (finding === 'swap' && !suspended) {
      await this.sanctions.apply(staffId, d.buyer_id, { kind: 'buying_suspended', reason: `Buyer finding (swap) on dispute ${disputeId}: ${text}`.slice(0, 500), related: { type: 'dispute', id: disputeId } }, ctx).catch(() => undefined);
      suspended = true;
    }
    await this.audit.record({ actorType: 'staff', actorId: staffId, action: 'disputes.dispute.buyer_finding', objectType: 'dispute', objectId: disputeId, after: { finding, suspended }, reason: text }, this.db.manager);
    await recordMessage(this.db, disputeId, d.buyer_id, 'dispute.buyer_finding', { finding }, `dispute:${disputeId}:buyer-finding`);
    return { strike: true, suspended };
  }

  /** delivery.return.delivered (Unit 4): the item is back with the seller; ignored unless a dispute awaits it. */
  async onReturnDelivered(e: OutboxEvent): Promise<boolean> {
    const orderId = e.aggregateId;
    const [d] = (await this.db.query(`SELECT id FROM disputes.disputes WHERE order_id = $1 AND status = 'awaiting_return'`, [orderId])) as { id: string }[];
    if (!d) return false; // a courier return without a dispute (FR-DLV-12), or already completed
    await this.completeReturn(d.id, orderId);
    return true;
  }

  /** disputes.dispute.decided: after the commit, the chat hold is released and both parties told (FR-DSP-07). */
  async onDecided(e: OutboxEvent): Promise<void> {
    const [d] = (await this.db.query(`SELECT order_id, buyer_id, seller_id, status FROM disputes.disputes WHERE id = $1`, [e.aggregateId])) as { order_id: string; buyer_id: string; seller_id: string; status: string }[];
    if (!d) return;
    const view = await this.orders.getOrderForParty(d.order_id, d.buyer_id);
    if (d.status === 'decided') {
      const thread = await this.chat.threadFor(view.listing.id, d.buyer_id);
      if (thread) await this.chat.release(thread, 'dispute', e.aggregateId);
    }
    const params = { listing_title: view.listing.title };
    const [o] = (await this.db.query(`SELECT outcome, item_refund FROM disputes.disputes WHERE id = $1`, [e.aggregateId])) as { outcome: string | null; item_refund: string | null }[];
    for (const user of [d.buyer_id, d.seller_id]) {
      await recordMessage(this.db, e.aggregateId, user, 'dispute.decided', { ...params, outcome: o?.outcome ?? null, itemRefund: o?.item_refund ?? null, status: d.status }, `dispute:${e.aggregateId}:decided:${d.status}`);
      await this.notifier.notify(user, 'dispute.decided', params, `dispute:${e.aggregateId}:decided:${d.status}`, { type: 'dispute', id: e.aggregateId });
    }
  }

  // ------------------------------------------------------------------ the decision

  private validate(d: CaseRow, dec: Decision): void {
    const reason = dec.reason.normalize('NFC').trim();
    if (reason.length < 20) throw new Problem('validation-failed', { errors: [{ field: 'reason', reason: 'too-short' }] });
    if (dec.outcome === 'partial_refund') {
      const r = dec.itemRefund && /^\d+$/.test(dec.itemRefund) ? BigInt(dec.itemRefund) : 0n;
      if (r <= 0n || r >= BigInt(d.item_price)) throw new Problem('validation-failed', { errors: [{ field: 'itemRefund', reason: 'between-zero-and-item-price' }] });
    } else if (dec.itemRefund !== undefined && dec.itemRefund !== null) {
      throw new Problem('validation-failed', { errors: [{ field: 'itemRefund', reason: 'partial-refund-only' }] });
    }
    if (dec.outcome === 'refund_after_return' && d.item_kind === 'game_account') throw new Problem('validation-failed', { errors: [{ field: 'outcome', reason: 'not-for-this-item' }] });
    if (dec.outcome === 'refund_after_return' && !dec.returnPayer) throw new Problem('validation-failed', { errors: [{ field: 'returnPayer', reason: 'required' }] });
  }

  /** The approval's handler: the proposer (the assigned operator) decides with the approval's id. */
  private async decideApproved(a: Approval, tx: EntityManager): Promise<void> {
    const p = a.payload as { outcome: DecisionOutcome; itemRefund: string | null; returnPayer: 'buyer' | 'seller' | null; reason: string };
    const d = await this.find(tx, a.targetId);
    if (d.status !== 'under_review') throw new Problem('approval-closed'); // withdrawn or decided meanwhile
    await this.execute(tx, d, a.proposedBy, { outcome: p.outcome, reason: p.reason, itemRefund: p.itemRefund ?? undefined, returnPayer: p.returnPayer ?? undefined }, a.id);
  }

  /** One transaction: the order, then the dispute, then the escrow (DC-14); the return shipment for (d). */
  private async execute(m: EntityManager, d: CaseRow, staffId: string, dec: Decision, approvalId: string | null): Promise<string> {
    const facts = await this.orders.lockForFulfilment(d.order_id, m);
    let fare: bigint | null = null;
    if (dec.outcome === 'refund_after_return') {
      fare = 0n; // a meetup order is returned by meetup
      if (facts.fulfilment === 'courier') {
        const forward = (await this.deliveryQuery.fulfilmentRecord(d.order_id)).shipments.find((s) => s.direction === 'forward');
        if (!forward?.dropoff.area || !forward.pickup.area) throw new Problem('validation-failed', { errors: [{ field: 'outcome', reason: 'no-forward-shipment' }] });
        const quote = await this.delivery.quoteReturn(d.order_id, forward.dropoff.area.id, forward.pickup.area.id);
        await this.delivery.bookReturn(d.order_id, quote.id, dec.returnPayer!, m);
        fare = BigInt(quote.fee);
      }
    }
    const cp47 = (await this.params.current()).get<{ strikes: number; window: string }>('CP-47');
    try {
      const [{ status }] = (await m.query(
        `SELECT disputes.decide($1, $2, $3, $4, $5, $6, $7, $8, $9::interval, $10) AS status`,
        [d.id, staffId, dec.outcome, dec.reason.normalize('NFC').trim(), dec.outcome === 'partial_refund' ? dec.itemRefund : null, fare?.toString() ?? null,
         dec.outcome === 'refund_after_return' ? dec.returnPayer : null, approvalId, cp47.window, cp47.strikes],
      )) as { status: string }[];
      const outcome = dec.outcome === 'release' ? { kind: 'release' as const }
        : dec.outcome === 'full_refund' ? { kind: 'full' as const }
          : dec.outcome === 'partial_refund' ? { kind: 'partial' as const, itemRefund: BigInt(dec.itemRefund!) }
            : { kind: 'after_return' as const };
      await this.escrow.applyDisputeOutcome(d.order_id, d.id, outcome, m);
      await this.audit.record({
        actorType: 'staff', actorId: staffId, action: 'disputes.dispute.decided', objectType: 'dispute', objectId: d.id, approvalId,
        after: { outcome: dec.outcome, itemRefund: dec.itemRefund ?? null, returnPayer: dec.returnPayer ?? null, status }, reason: dec.reason,
      }, m);
      return status;
    } catch (err) {
      throw problemOf(err) ?? err;
    }
  }

  private async completeReturn(disputeId: string, orderId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      await this.orders.lockForFulfilment(orderId, m); // DC-14
      try {
        await m.query(`SELECT disputes.return_completed($1)`, [disputeId]);
      } catch (err) {
        throw problemOf(err) ?? err;
      }
      await this.escrow.applyDisputeOutcome(orderId, disputeId, { kind: 'return_completed' }, m); // the refund (I-44)
      await m.query(`INSERT INTO disputes.outbox (event_type, aggregate_id, payload) VALUES ('disputes.dispute.decided', $1, $2)`,
        [disputeId, JSON.stringify({ orderId, outcome: 'refund_after_return', status: 'decided' })]);
    });
  }

  private async handoverPhotos(orderId: string, staff: Principal, reason: string | undefined, ctx: CallContext) {
    const rows = (await this.db.query(`SELECT id, storage_key, at FROM delivery.handover_photos WHERE order_id = $1 ORDER BY at`, [orderId])) as { id: string; storage_key: string | null; at: Date }[];
    return Promise.all(rows.map(async (p) => ({ id: p.id, at: p.at.toISOString(), link: p.storage_key ? await this.vault.signedLink(p.storage_key, staff, reason, ctx) : null })));
  }

  private async assigned(staffId: string, disputeId: string): Promise<CaseRow> {
    const d = await this.find(this.db.manager, disputeId);
    if (d.assigned_to !== staffId) throw new Problem('not-claimed');
    return d;
  }

  private async find(m: EntityManager, id: string): Promise<CaseRow> {
    const [d] = (await m.query(`SELECT * FROM disputes.disputes WHERE id = $1`, [id])) as CaseRow[];
    if (!d) throw new Problem('not-found');
    return d;
  }

  private async tell(userId: string, template: string, params: Record<string, string | number>, key: string, chatExtra: Record<string, string | number> = {}): Promise<void> {
    const dispute = disputeOfKey(key);
    if (dispute) await recordMessage(this.db, dispute, userId, template, { ...params, ...chatExtra }, key);
    await this.notifier.notify(userId, template, params, key, dispute ? { type: 'dispute', id: dispute } : undefined).catch((err: Error) => this.log.warn(`notice ${template} to ${userId}: ${err.message}`));
  }
}

/** SEC-ACC-05: an address shown as its network (IPv4 /24, IPv6 /48). */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}::/48`;
  return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
}
