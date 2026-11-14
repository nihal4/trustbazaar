import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import type { Principal } from '../../../kernel/http/principal';
import { CHAT_COMMANDS, ChatCommands, NOTIFIER, Notifier } from '../../chat/ports';
import { DELIVERY_QUERIES, DeliveryQueries } from '../../delivery/ports';
import { FILE_VAULT, FileVaultPort } from '../../identity/ports';
import { ESCROW_COMMANDS, ESCROW_QUERY, EscrowCommands, EscrowQuery, ORDERS_PORT, OrdersPort, OrderView } from '../../orders/ports';
import type { DisputeCommands, DisputeType } from '../ports';

// Disputes on physical goods, the parties' side (docs/design/07_disputes_trust_staff.pdf sections 5.1 to 5.3 and 5.7;
// FR-DSP-01 to FR-DSP-04, FR-DSP-09 to FR-DSP-11; U7-03, first part). The operator's side (claim, case file, request
// for information, decision and outcomes) is the second part of U7-03; game-account disputes are U7-10's.
//  - Opening is one transaction in the lock order of DC-14: the order (OrdersPort.lockForFulfilment), the owning unit's
//    window check, disputes.open (refused while one is open, or for a type withdrawn before), and
//    EscrowCommands.freezeForDispute. After the commit the order's chat thread is held (I-40) and the parties told.
//  - The seller's first statement while the dispute is open (or awaiting them) is the response: the review starts.
//    Without a response in CP-20 (48 hours), the job starts the review on the evidence available.
//  - Evidence: up to CP-33 (10) images per dispute, re-encoded without metadata and encrypted by Unit 1's FileVault.
//  - The buyer withdraws before the decision: the escrow is held again (FR-DSP-10) and that type cannot be reopened.

const PHYSICAL: readonly DisputeType[] = ['not_as_described', 'damaged', 'not_received', 'other'];
const LIVE = ['open', 'under_review', 'awaiting_seller'];
/** Images only: Unit 1's FileVault re-encodes evidence as an image without metadata, so a PDF is refused (Decisions log, U7-03). */
export const EVIDENCE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_EVIDENCE_BYTES = 10_485_760; // CP-33

interface DisputeRow {
  id: string; order_id: string; buyer_id: string; seller_id: string; item_kind: string; type: DisputeType; description: string; status: string;
  opened_at: Date; seller_due_at: Date; info_due_at: Date | null; review_started_at: Date | null; decision_target_at: Date | null;
  outcome: string | null; item_refund: string | null; decision_reason: string | null; decided_at: Date | null; withdrawn_at: Date | null;
}

/** The database's refusals, as problems the parties can read. */
function problemOf(err: unknown): Problem | null {
  if (!(err instanceof QueryFailedError)) return null;
  const { code, message } = err.driverError as { code?: string; message?: string };
  const reason = (r: string, field = 'dispute') => new Problem('validation-failed', { errors: [{ field, reason: r }] });
  if (code === '42501') return new Problem('not-found');
  if (code !== '23514') return null;
  if (message?.includes('cannot be opened now')) return reason('dispute-not-allowed', 'type');
  if (message?.includes('already open')) return reason('dispute-open', 'order');
  if (message?.includes('withdrawn and cannot be reopened')) return reason('type-withdrawn', 'type');
  if (message?.includes('at most 10 evidence')) return reason('evidence-limit', 'file');
  if (message?.includes('evidence is accepted only') || message?.includes('dispute is closed')) return reason('closed');
  return null;
}

@Injectable()
export class DisputeService implements DisputeCommands {
  private readonly log = new Logger('Disputes');

  constructor(
    private readonly db: DataSource,
    @Inject(ORDERS_PORT) private readonly orders: OrdersPort,
    @Inject(ESCROW_QUERY) private readonly escrowQuery: EscrowQuery,
    @Inject(ESCROW_COMMANDS) private readonly escrow: EscrowCommands,
    @Inject(DELIVERY_QUERIES) private readonly delivery: DeliveryQueries,
    @Inject(CHAT_COMMANDS) private readonly chat: ChatCommands,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(FILE_VAULT) private readonly vault: FileVaultPort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** I-56: GET /orders/{id}/dispute-types: what the buyer may open now, from the owning units' checks. */
  async types(buyerId: string, orderId: string): Promise<{ types: DisputeType[]; openDisputeId: string | null }> {
    const o = await this.orders.getOrderForParty(orderId, buyerId); // not-found for a stranger
    if (o.role !== 'buyer') throw new Problem('not-found');
    const [open] = (await this.db.query(`SELECT id FROM disputes.disputes WHERE order_id = $1 AND status NOT IN ('decided', 'withdrawn')`, [orderId])) as { id: string }[];
    if (open) return { types: [], openDisputeId: open.id };
    if (o.listing.itemKind !== 'physical') return { types: [], openDisputeId: null }; // game accounts: U7-10
    const withdrawn = new Set(((await this.db.query(`SELECT type FROM disputes.disputes WHERE order_id = $1 AND status = 'withdrawn'`, [orderId])) as { type: DisputeType }[]).map((r) => r.type));
    const allowed: DisputeType[] = [];
    for (const type of PHYSICAL) if (!withdrawn.has(type) && (await this.windowOk(orderId, type))) allowed.push(type);
    return { types: allowed, openDisputeId: null };
  }

  /** POST /orders/{id}/disputes (FR-DSP-01): the buyer opens one, with a type and a description. */
  async openByBuyer(buyerId: string, orderId: string, d: { type: DisputeType; description: string }): Promise<{ disputeId: string }> {
    const view = await this.orders.getOrderForParty(orderId, buyerId);
    if (view.role !== 'buyer') throw new Problem('not-found');
    const disputeId = await this.db.transaction((m) => this.open({ orderId, type: d.type, description: d.description, by: 'buyer' }, m, view));
    await this.afterOpen(disputeId, view);
    return { disputeId };
  }

  /** DisputeCommands (Unit 5, in its own transaction, DC-13). Game-account disputes come with U7-10. */
  async open(o: { orderId: string; type: DisputeType; description: string; by: 'buyer' | 'system' }, tx: EntityManager, known?: OrderView): Promise<string> {
    const description = o.description.normalize('NFC').trim();
    if (description.length < 20) throw new Problem('validation-failed', { errors: [{ field: 'description', reason: 'too-short' }] });
    const facts = await this.orders.lockForFulfilment(o.orderId, tx); // DC-14: the order first
    if (facts.itemKind !== 'physical') throw new Problem('feature-off', { errors: [{ field: 'type', reason: 'game-account-disputes-not-yet-available' }] });
    if (!PHYSICAL.includes(o.type)) throw new Problem('validation-failed', { errors: [{ field: 'type', reason: 'not-for-this-item' }] });
    // FR-DSP-11: one at a time (also refused by disputes_one_open); said before the window check, which the frozen escrow fails
    const [open] = (await tx.query(`SELECT 1 FROM disputes.disputes WHERE order_id = $1 AND status NOT IN ('decided', 'withdrawn')`, [o.orderId])) as unknown[];
    if (open) throw new Problem('validation-failed', { errors: [{ field: 'order', reason: 'dispute-open' }] });
    const view = known ?? (await this.orders.getOrderForParty(o.orderId, facts.buyerId));
    const windowOk = facts.escrowState === 'held' && (await this.windowOk(o.orderId, o.type));
    const sellerWindow = (await this.params.current()).get<string>('CP-20');
    try {
      const [{ id }] = (await tx.query(
        `SELECT disputes.open($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::interval, $11) AS id`,
        [o.orderId, facts.buyerId, facts.sellerId, facts.itemKind, o.type, description, view.itemPrice, view.escrow?.amountCollected ?? view.total, windowOk, sellerWindow, o.by],
      )) as { id: string }[];
      await this.escrow.freezeForDispute(o.orderId, id, tx); // FR-DSP-02: no automatic release from here
      return id;
    } catch (err) {
      throw problemOf(err) ?? err;
    }
  }

  /** GET /disputes/{id}: the party's view, with both parties' statements and their own evidence. */
  async view(viewer: Principal & { type: 'user' }, disputeId: string) {
    const d = await this.forParty(viewer.userId, disputeId);
    const role = d.buyer_id === viewer.userId ? 'buyer' : 'seller';
    const statements = (await this.db.query(`SELECT party, text, at FROM disputes.statements WHERE dispute_id = $1 ORDER BY id`, [disputeId])) as { party: string; text: string; at: Date }[];
    const evidence = (await this.db.query(
      `SELECT id, storage_key, mime, byte_size, at FROM disputes.evidence WHERE dispute_id = $1 AND party = $2 ORDER BY at`, [disputeId, role],
    )) as { id: string; storage_key: string; mime: string; byte_size: number; at: Date }[];
    const iso = (x: Date | null) => (x ? x.toISOString() : null);
    return {
      id: d.id, orderId: d.order_id, role, type: d.type, status: d.status, description: d.description,
      openedAt: d.opened_at.toISOString(), sellerDueAt: d.seller_due_at.toISOString(), infoDueAt: iso(d.info_due_at),
      reviewStartedAt: iso(d.review_started_at), decisionTargetAt: iso(d.decision_target_at),
      outcome: d.outcome ? { kind: d.outcome, itemRefund: d.item_refund, reason: d.decision_reason, decidedAt: iso(d.decided_at) } : null,
      withdrawnAt: iso(d.withdrawn_at),
      statements: statements.map((s) => ({ party: s.party, text: s.text, at: s.at.toISOString() })),
      evidence: await Promise.all(evidence.map(async (e) => ({
        id: e.id, mime: e.mime, size: e.byte_size, at: e.at.toISOString(), link: await this.vault.signedLink(e.storage_key, viewer),
      }))),
    };
  }

  /** POST /disputes/{id}/statements (FR-DSP-04): the seller's first while it is expected is the response. */
  async statement(userId: string, disputeId: string, text: string): Promise<{ status: string }> {
    const body = text.normalize('NFC').trim();
    if (!body) throw new Problem('validation-failed', { errors: [{ field: 'text', reason: 'empty' }] });
    const d = await this.forParty(userId, disputeId);
    if (!LIVE.includes(d.status)) throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'closed' }] });
    const seller = d.seller_id === userId;
    const due = d.info_due_at ?? d.seller_due_at;
    try {
      if (seller && (d.status === 'open' || d.status === 'awaiting_seller') && this.clock.now() < due) {
        const target = (await this.params.current()).get<string>('CP-21');
        await this.db.query(`SELECT disputes.seller_respond($1, $2, $3, $4::interval)`, [disputeId, userId, body, target]);
      } else {
        await this.db.query(`INSERT INTO disputes.statements (dispute_id, party, text) VALUES ($1, $2, $3)`, [disputeId, seller ? 'seller' : 'buyer', body]);
      }
    } catch (err) {
      throw problemOf(err) ?? err;
    }
    const [{ status }] = (await this.db.query(`SELECT status FROM disputes.disputes WHERE id = $1`, [disputeId])) as { status: string }[];
    return { status };
  }

  /** POST /disputes/{id}/evidence: one file, kept encrypted; at most CP-33 per dispute. */
  async evidence(userId: string, disputeId: string, file: { buffer: Buffer; mimetype: string; size: number }): Promise<{ evidenceId: string }> {
    const d = await this.forParty(userId, disputeId);
    if (!(EVIDENCE_MIME as readonly string[]).includes(file.mimetype)) throw new Problem('validation-failed', { errors: [{ field: 'file', reason: 'type' }] });
    if (!LIVE.includes(d.status)) throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'closed' }] });
    const stored = await this.vault.store({ purpose: 'dispute_evidence', ownerId: userId, bytes: new Uint8Array(file.buffer) });
    try {
      const [{ id }] = (await this.db.query(
        `INSERT INTO disputes.evidence (dispute_id, party, storage_key, sha256, mime, byte_size) VALUES ($1, $2, $3, decode($4, 'hex'), $5, $6) RETURNING id`,
        [disputeId, d.seller_id === userId ? 'seller' : 'buyer', stored.key, stored.sha256, stored.mime, stored.size],
      )) as { id: string }[];
      return { evidenceId: id };
    } catch (err) {
      await this.vault.erase(stored.key).catch(() => undefined); // nothing kept for a refused file
      throw problemOf(err) ?? err;
    }
  }

  /** POST /disputes/{id}/withdraw (FR-DSP-10): before the decision; the escrow is held again. */
  async withdraw(buyerId: string, disputeId: string): Promise<{ status: 'withdrawn' }> {
    const d = await this.forParty(buyerId, disputeId);
    if (d.buyer_id !== buyerId) throw new Problem('not-found');
    try {
      await this.db.transaction(async (m) => {
        await this.orders.lockForFulfilment(d.order_id, m); // DC-14
        await m.query(`SELECT disputes.withdraw($1, $2)`, [disputeId, buyerId]);
        await this.escrow.withdrawDispute(d.order_id, disputeId, m);
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as { message?: string }).message?.includes('cannot be withdrawn')) {
        throw new Problem('validation-failed', { errors: [{ field: 'dispute', reason: 'closed' }] });
      }
      throw problemOf(err) ?? err;
    }
    const view = await this.orders.getOrderForParty(d.order_id, buyerId);
    await this.releaseThread(view, disputeId);
    await this.tell(d.seller_id, 'dispute.withdrawn_seller', { listing_title: view.listing.title }, `dispute:${disputeId}:withdrawn`);
    return { status: 'withdrawn' };
  }

  /** The CP-20 job (every 5 minutes): no response in time, so the review starts on the evidence available. */
  async startOverdueReviews(): Promise<number> {
    const target = (await this.params.current()).get<string>('CP-21');
    const due = (await this.db.query(
      `SELECT id FROM disputes.disputes WHERE (status = 'open' AND seller_due_at <= now()) OR (status = 'awaiting_seller' AND info_due_at <= now())
        ORDER BY opened_at LIMIT 200`,
    )) as { id: string }[];
    let n = 0;
    for (const { id } of due) {
      const [{ started }] = (await this.db.query(`SELECT disputes.seller_window_ended($1, $2::interval) AS started`, [id, target])) as { started: boolean }[];
      if (started) n++;
    }
    return n;
  }

  private async windowOk(orderId: string, type: DisputeType): Promise<boolean> {
    if (type === 'not_received') return this.delivery.notReceivedAllowed(orderId); // Unit 4 (FR-DLV-11); held is checked by the caller
    return this.escrowQuery.disputeAllowed(orderId, this.clock.now()); // Unit 2: held, and inside CP-18 once delivered
  }

  /** After the opening's commit: the thread is held (I-40) and both parties told (FR-DSP-03). */
  private async afterOpen(disputeId: string, view: OrderView): Promise<void> {
    const thread = await this.chat.threadFor(view.listing.id, view.buyerId);
    if (thread) await this.chat.hold(thread, 'dispute', disputeId).catch((err: Error) => this.log.warn(`holding the thread of dispute ${disputeId}: ${err.message}`));
    const hours = Math.round((await this.params.current()).ms('CP-20') / 3_600_000);
    await this.tell(view.sellerId, 'dispute.opened_seller', { listing_title: view.listing.title, hours }, `dispute:${disputeId}:opened`);
    await this.tell(view.buyerId, 'dispute.opened_buyer', { listing_title: view.listing.title }, `dispute:${disputeId}:opened`);
  }

  private async releaseThread(view: OrderView, disputeId: string): Promise<void> {
    const thread = await this.chat.threadFor(view.listing.id, view.buyerId);
    if (thread) await this.chat.release(thread, 'dispute', disputeId).catch((err: Error) => this.log.warn(`releasing the thread of dispute ${disputeId}: ${err.message}`));
  }

  private async tell(userId: string, template: string, params: Record<string, string | number>, key: string): Promise<void> {
    await this.notifier.notify(userId, template, params, key).catch((err: Error) => this.log.warn(`notice ${template} to ${userId}: ${err.message}`));
  }

  /** The dispute, for one of its parties only (SEC-SDL-09: not-found for anyone else). */
  private async forParty(userId: string, disputeId: string): Promise<DisputeRow> {
    const [d] = (await this.db.query(`SELECT * FROM disputes.disputes WHERE id = $1`, [disputeId])) as DisputeRow[];
    if (!d || (d.buyer_id !== userId && d.seller_id !== userId)) throw new Problem('not-found');
    return d;
  }
}
