import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { CancellationRequest, Escrow, EscrowHistory, Order, OrdersOutboxEvent, PaymentAttempt, Payout, Refund, Settlement } from '../db/entities';
import type { RefundReason } from '../db/enums';
import type { DeliverySource, DisputeOutcome, EscrowCommands, EscrowQuery, EscrowView, FulfilmentStep } from '../ports';
import { post } from './ledger';
import { split } from './split';

// Escrow (docs/design/02_orders_payments.pdf sections 5.6 to 5.10; FR-PAY-05 to FR-PAY-11, FR-DSP-02, 06, 10).
//
// The commands run in the caller's transaction (DC-13). Each locks the order and then the escrow (DC-14:
// listing, order, delivery row, escrow, attempt), so a person's action, a scheduled job and a dispute on
// the same order are serialised: whichever commits first decides, and the others see its result. Steps and
// events that come twice, or for an order in the wrong state, are ignored and logged; the first time stands.
//
// settle() is the one place where escrow money moves. From the split it writes, in the same transaction:
// the escrow's terminal state and history, the settlement record, the journal entry (section 4.3), a pending
// refund for the buyer's part (sent by U2-05's worker), the seller's payout row (status by the payout account
// and a fraud hold), the order's closing, the escrow event and the audit entry.
const DAY = 86_400_000;

@Injectable()
export class EscrowService implements EscrowCommands, EscrowQuery {
  private readonly log = new Logger('EscrowService');

  constructor(
    private readonly db: DataSource,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------- fulfilment (section 5.6)

  async recordFulfilmentStep(orderId: string, step: FulfilmentStep, at: Date, tx: EntityManager): Promise<void> {
    const { o } = await this.lock(tx, orderId);
    if (o.status !== 'paid' || o.fulfilmentStep !== step || o.fulfilmentDoneAt !== null) {
      this.log.warn(`order ${orderId}: step ${step} ignored (status ${o.status}, expected ${o.fulfilmentStep}, done ${o.fulfilmentDoneAt?.toISOString() ?? 'no'})`);
      return;
    }
    await tx.getRepository(Order).update({ id: orderId }, { fulfilmentDoneAt: at });
    await this.audit.record({ actorType: 'system', action: 'orders.fulfilment.recorded', objectType: 'order', objectId: orderId, after: { step, at: at.toISOString() } }, tx);
  }

  /** A meetup handover is the step and the delivery event at once (handover_code). */
  async recordDeliveryEvent(orderId: string, source: DeliverySource, at: Date, tx: EntityManager): Promise<void> {
    const { o, e } = await this.lock(tx, orderId);
    const stepDone = o.fulfilmentDoneAt !== null || (source === 'handover_code' && o.fulfilmentStep === 'meetup_handover');
    if (o.status !== 'paid' || !e || o.deliveryEventAt !== null || !stepDone) {
      this.log.warn(`order ${orderId}: delivery event ${source} ignored (status ${o.status}, event ${o.deliveryEventAt?.toISOString() ?? 'none'}, step done ${stepDone})`);
      return;
    }
    // section 5.2: from the order's own parameter version (FR-OPS-08)
    const values = await this.params.atVersion(o.paramsVersion);
    const game = e.releasePolicy === 'game_protection';
    const windowEnds = new Date(at.getTime() + values.ms(game ? 'CP-24' : 'CP-18'));
    const autoRelease = new Date(at.getTime() + values.ms(game ? 'CP-24' : 'CP-19'));
    await tx.getRepository(Order).update({ id: orderId }, { fulfilmentDoneAt: o.fulfilmentDoneAt ?? at, deliveryEventAt: at, deliveryEventSource: source });
    await tx.getRepository(Escrow).update({ orderId }, { disputeWindowEndsAt: windowEnds, autoReleaseAt: autoRelease });
    await this.event(tx, 'orders.order.delivered', orderId, {
      orderId, buyerId: o.buyerId, sellerId: o.sellerId, source, at: at.toISOString(), disputeWindowEndsAt: windowEnds.toISOString(), autoReleaseAt: autoRelease.toISOString(),
    });
    await this.audit.record({ actorType: 'system', action: 'orders.order.delivered', objectType: 'order', objectId: orderId, after: { source, at: at.toISOString() } }, tx);
  }

  async refundCourierReturned(orderId: string, courierCharge: bigint, tx: EntityManager): Promise<void> {
    const { o, e } = await this.lock(tx, orderId);
    if (!e || e.state !== 'held') {
      this.log.warn(`order ${orderId}: courier return refund ignored (escrow ${e?.state ?? 'none'})`);
      return;
    }
    // FR-DLV-12: everything back, the fee included, whatever the courier did
    await this.settle(tx, o, e, { itemRefund: BigInt(o.itemPrice), courierDone: false, reason: 'courier_returned', actor: 'system', note: 'returned to the seller by the courier' });
    if (courierCharge > 0n) await this.recordCourierCost(orderId, courierCharge, tx);
  }

  async recordCourierCost(orderId: string, amount: bigint, tx: EntityManager): Promise<void> {
    if (amount <= 0n) return;
    await post(tx, 'courier_return_charge', orderId, null, 'courier charge for a failed delivery (FR-DLV-12)', [
      ['expense_courier_returns', null, amount], ['courier_payable', null, -amount],
    ]);
  }

  // ---------------------------------------------------------------- disputes (section 5.10)

  async freezeForDispute(orderId: string, disputeId: string, tx: EntityManager): Promise<void> {
    const { o, e } = await this.lock(tx, orderId);
    if (!e || !this.allowed(o, e, this.clock.now())) throw new Problem('order-state', { errors: [{ field: 'order', reason: 'dispute-not-allowed' }] });
    await tx.getRepository(Escrow).update({ orderId }, { state: 'frozen_disputed', openDisputeId: disputeId });
    await this.history(tx, orderId, 'held', 'frozen_disputed', 'system', `dispute ${disputeId} opened`, disputeId);
    await this.event(tx, 'orders.escrow.frozen', orderId, { orderId, disputeId, buyerId: o.buyerId, sellerId: o.sellerId });
  }

  async applyDisputeOutcome(orderId: string, disputeId: string, outcome: DisputeOutcome, tx: EntityManager): Promise<void> {
    const { o, e } = await this.lock(tx, orderId);
    if (!e || e.state !== 'frozen_disputed' || e.openDisputeId !== disputeId) throw new Problem('order-state', { errors: [{ field: 'dispute', reason: 'not-the-open-dispute' }] });
    const item = BigInt(o.itemPrice);
    const courierDone = this.courierDone(o);
    const actor = 'staff' as const;
    switch (outcome.kind) {
      case 'release':
        return this.settle(tx, o, e, { itemRefund: 0n, courierDone, reason: null, actor, note: `dispute ${disputeId}: release`, disputeId });
      case 'full':
      case 'return_completed':
        // the item price back, and the fee too unless the courier picked up (then the escrow ends partially refunded)
        return this.settle(tx, o, e, { itemRefund: item, courierDone, reason: 'dispute_full', actor, note: `dispute ${disputeId}: ${outcome.kind === 'full' ? 'full refund' : 'refund after return'}`, disputeId });
      case 'partial':
        if (outcome.itemRefund <= 0n || outcome.itemRefund >= item) throw new Problem('validation-failed', { errors: [{ field: 'itemRefund', reason: 'between-zero-and-item-price' }] });
        return this.settle(tx, o, e, { itemRefund: outcome.itemRefund, courierDone, reason: 'dispute_partial', actor, note: `dispute ${disputeId}: partial refund`, disputeId });
      case 'after_return':
        // (d) stays frozen; the refund follows with return_completed (Unit 7, I-44)
        await this.history(tx, orderId, 'frozen_disputed', 'frozen_disputed', actor, `dispute ${disputeId}: refund after the item is returned`, disputeId);
        return;
    }
  }

  async withdrawDispute(orderId: string, disputeId: string, tx: EntityManager): Promise<void> {
    const { e } = await this.lock(tx, orderId);
    if (!e || e.state !== 'frozen_disputed' || e.openDisputeId !== disputeId) throw new Problem('order-state', { errors: [{ field: 'dispute', reason: 'not-the-open-dispute' }] });
    const later = new Date(this.clock.now().getTime() + DAY);
    const autoReleaseAt = e.autoReleaseAt === null ? null : e.autoReleaseAt > later ? e.autoReleaseAt : later;
    await tx.getRepository(Escrow).update({ orderId }, { state: 'held', openDisputeId: null, autoReleaseAt });
    await this.history(tx, orderId, 'frozen_disputed', 'held', 'user', `dispute ${disputeId} withdrawn`, disputeId);
  }

  // ---------------------------------------------------------------- the buyer and the seller (sections 5.7, 5.8)

  /** FR-PAY-07(a): the buyer confirms receipt after the delivery event (standard orders; game accounts use releaseEarly). */
  async confirmReceipt(buyerId: string, orderId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const { o, e } = await this.party(m, orderId, buyerId, 'buyer');
      if (!e || e.state !== 'held' || o.deliveryEventAt === null || e.releasePolicy !== 'standard') throw new Problem('order-state');
      await this.settle(m, o, e, { itemRefund: 0n, courierDone: this.courierDone(o), reason: null, actor: 'user', actorId: buyerId, note: 'buyer confirmed receipt' });
    });
  }

  /** FR-GAM-17: a game-account buyer releases before the protection period ends (after step-up). */
  async releaseEarly(buyerId: string, orderId: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const { o, e } = await this.party(m, orderId, buyerId, 'buyer');
      if (!e || e.state !== 'held' || o.deliveryEventAt === null || e.releasePolicy !== 'game_protection') throw new Problem('order-state');
      await this.settle(m, o, e, { itemRefund: 0n, courierDone: false, reason: null, actor: 'user', actorId: buyerId, note: 'buyer released early (FR-GAM-17)' });
    });
  }

  /** FR-PAY-07(b), FR-GAM-17: for the auto-release job (U2-07); false when nothing was due (re-checked under the lock). */
  async autoRelease(orderId: string): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const { o, e } = await this.lock(m, orderId);
      if (!e || e.state !== 'held' || e.autoReleaseAt === null || e.autoReleaseAt > this.clock.now()) return false;
      await this.settle(m, o, e, { itemRefund: 0n, courierDone: this.courierDone(o), reason: null, actor: 'system', note: e.releasePolicy === 'game_protection' ? 'protection period ended' : 'auto-release after the delivery event' });
      return true;
    });
  }

  /**
   * FR-PAY-08: for the fulfilment job (U2-07). A paid order whose required step is not recorded by its
   * fulfilment_due_at, with the escrow still held (no open dispute), is refunded in full; the refund event
   * carries the reason fulfilment_deadline and the seller, so Unit 7 can count the strike (I-44). Pending
   * cancellation requests lapse. False when nothing was due (re-checked under the lock).
   */
  async refundMissedDeadline(orderId: string): Promise<boolean> {
    return this.db.transaction(async (m) => {
      const { o, e } = await this.lock(m, orderId);
      const now = this.clock.now();
      if (o.status !== 'paid' || !e || e.state !== 'held' || o.fulfilmentDoneAt !== null || !o.fulfilmentDueAt || o.fulfilmentDueAt > now) return false;
      await m.getRepository(CancellationRequest).update({ orderId, status: 'pending' }, { status: 'lapsed', decidedAt: now });
      await this.settle(m, o, e, { itemRefund: BigInt(o.itemPrice), courierDone: false, reason: 'fulfilment_deadline', actor: 'system', note: `fulfilment step ${o.fulfilmentStep} missed its deadline` });
      return true;
    });
  }

  /** FR-PAY-09: the buyer asks to cancel a paid order before the delivery event; one request at a time. */
  async requestCancellation(buyerId: string, orderId: string, reason: string): Promise<string> {
    return this.db.transaction(async (m) => {
      const { o, e } = await this.party(m, orderId, buyerId, 'buyer');
      if (!e || e.state !== 'held' || o.deliveryEventAt !== null) throw new Problem('order-state');
      if (await m.getRepository(CancellationRequest).findOneBy({ orderId, status: 'pending' })) throw new Problem('order-state', { errors: [{ field: 'request', reason: 'already-pending' }] });
      const { identifiers } = await m.getRepository(CancellationRequest).insert({ orderId, requestedBy: buyerId, reason: reason.trim() });
      await this.event(m, 'orders.cancellation.requested', orderId, { orderId, buyerId, sellerId: o.sellerId, requestId: identifiers[0].id });
      return identifiers[0].id as string;
    });
  }

  /** FR-PAY-09: the seller accepts (a full refund) or declines the buyer's request. */
  async decideCancellation(sellerId: string, orderId: string, requestId: string, decision: 'accept' | 'decline'): Promise<void> {
    await this.db.transaction(async (m) => {
      const { o, e } = await this.party(m, orderId, sellerId, 'seller');
      const r = await m.getRepository(CancellationRequest).findOne({ where: { id: requestId, orderId }, lock: { mode: 'pessimistic_write' } });
      if (!r) throw new Problem('not-found');
      if (r.status !== 'pending') throw new Problem('order-state');
      const now = this.clock.now();
      if (decision === 'decline') {
        await m.getRepository(CancellationRequest).update({ id: requestId }, { status: 'declined', decidedAt: now });
        await this.event(m, 'orders.cancellation.declined', orderId, { orderId, buyerId: o.buyerId, sellerId, requestId });
        return;
      }
      if (!e || e.state !== 'held' || o.deliveryEventAt !== null) throw new Problem('order-state');
      await m.getRepository(CancellationRequest).update({ id: requestId }, { status: 'accepted', decidedAt: now });
      // "refund the buyer in full": the item and the delivery fee
      await this.settle(m, o, e, { itemRefund: BigInt(o.itemPrice), courierDone: false, reason: 'cancellation', actor: 'user', actorId: sellerId, note: `cancellation request ${requestId} accepted by the seller` });
    });
  }

  /** FR-PAY-09, FR-TNS-04: the seller cancels after payment, before the delivery event: a full refund and a strike. */
  async sellerCancel(sellerId: string, orderId: string, reason: string): Promise<void> {
    await this.db.transaction(async (m) => {
      const { o, e } = await this.party(m, orderId, sellerId, 'seller');
      if (!e || e.state !== 'held' || o.deliveryEventAt !== null) throw new Problem('order-state');
      await m.getRepository(CancellationRequest).update({ orderId, status: 'pending' }, { status: 'lapsed', decidedAt: this.clock.now() });
      await this.settle(m, o, e, { itemRefund: BigInt(o.itemPrice), courierDone: false, reason: 'cancellation', actor: 'user', actorId: sellerId, note: `cancelled by the seller: ${reason.trim()}` });
      await this.event(m, 'orders.order.cancelled_by_seller', orderId, { orderId, sellerId, buyerId: o.buyerId, reason: reason.trim() }); // strike (Unit 7)
    });
  }

  // ---------------------------------------------------------------- EscrowQuery

  async getEscrow(orderId: string): Promise<EscrowView> {
    const o = await this.db.getRepository(Order).findOneBy({ id: orderId });
    const e = await this.db.getRepository(Escrow).findOneBy({ orderId });
    if (!o || !e) throw new Problem('not-found');
    return {
      orderId, orderStatus: o.status, state: e.state, releasePolicy: e.releasePolicy, amountCollected: e.amountCollected, amountReleased: e.amountReleased,
      amountRefunded: e.amountRefunded, disputeWindowEndsAt: e.disputeWindowEndsAt, autoReleaseAt: e.autoReleaseAt, openDisputeId: e.openDisputeId, deliveryEventAt: o.deliveryEventAt,
    };
  }

  async disputeAllowed(orderId: string, at: Date): Promise<boolean> {
    const o = await this.db.getRepository(Order).findOneBy({ id: orderId });
    const e = await this.db.getRepository(Escrow).findOneBy({ orderId });
    return !!o && !!e && this.allowed(o, e, at);
  }

  /** Held, paid, and strictly before the end of the window once the delivery event set it (FR-DSP-11). */
  private allowed(o: Order, e: Escrow, at: Date): boolean {
    return o.status === 'paid' && e.state === 'held' && (e.disputeWindowEndsAt === null || at < e.disputeWindowEndsAt);
  }

  // ---------------------------------------------------------------- the money (sections 4.3, 4.4, 5.7)

  private async settle(
    m: EntityManager,
    o: Order,
    e: Escrow,
    s: { itemRefund: bigint; courierDone: boolean; reason: RefundReason | null; actor: 'system' | 'staff' | 'user'; actorId?: string; note: string; disputeId?: string },
  ): Promise<void> {
    const item = BigInt(o.itemPrice);
    const fee = BigInt(o.deliveryFee);
    const total = BigInt(e.amountCollected);
    const p = split(item, fee, s.itemRefund, s.courierDone, o.commissionBps, o.deliveryMarginBps);
    const released = total - p.refundTotal;
    const state = p.refundTotal === 0n ? 'released' : released === 0n ? 'refunded' : 'partially_refunded';
    const now = this.clock.now();

    await m.getRepository(Escrow).update({ orderId: o.id }, {
      state, amountReleased: released.toString(), amountRefunded: p.refundTotal.toString(), openDisputeId: null, terminalAt: now,
    });
    await this.history(m, o.id, e.state, state, s.actor, s.note, s.disputeId ?? null, released, p.refundTotal, s.actorId);
    await m.getRepository(Settlement).insert({
      orderId: o.id, amountCollected: total.toString(), itemPrice: item.toString(), deliveryFee: fee.toString(), commission: p.commission.toString(),
      courierPayout: p.courierPayout.toString(), deliveryMargin: p.deliveryMargin.toString(), sellerPayout: p.sellerPayout.toString(),
      refundTotal: p.refundTotal.toString(), commissionBps: o.commissionBps, deliveryMarginBps: o.deliveryMarginBps,
    });
    const kind = state === 'released' ? 'escrow_release' : state === 'refunded' ? 'escrow_refund' : 'escrow_partial';
    await post(m, kind, o.id, s.disputeId ?? null, s.note, [
      ['escrow_liability', o.id, total],
      ['buyer_refund_payable', o.buyerId, -p.refundTotal],
      ['seller_payable', o.sellerId, -p.sellerPayout],
      ['revenue_commission', null, -p.commission],
      ['courier_payable', null, -p.courierPayout],
      ['revenue_delivery_margin', null, -p.deliveryMargin],
    ]);
    let refundId: string | null = null;
    if (p.refundTotal > 0n) {
      const paid = await m.getRepository(PaymentAttempt).findOneByOrFail({ orderId: o.id, status: 'succeeded' });
      const { identifiers } = await m.getRepository(Refund).insert({ attemptId: paid.id, orderId: o.id, amount: p.refundTotal.toString(), reason: s.reason ?? 'fee_refund' }); // a release keeps back an unused delivery fee
      refundId = identifiers[0].id as string;
    }
    if (p.sellerPayout > 0n) await this.createPayout(m, o, p.sellerPayout);
    await m.getRepository(Order).update({ id: o.id }, { status: 'closed', closedAt: now });
    await this.event(m, `orders.escrow.${state}`, o.id, {
      orderId: o.id, buyerId: o.buyerId, sellerId: o.sellerId, reason: s.reason, refunded: p.refundTotal.toString(), sellerPayout: p.sellerPayout.toString(), disputeId: s.disputeId ?? null, refundId,
    });
    await this.audit.record({ actorType: s.actor, actorId: s.actorId ?? null, action: `orders.escrow.${state}`, objectType: 'order', objectId: o.id, before: { state: e.state }, after: { state, released: released.toString(), refunded: p.refundTotal.toString() }, reason: s.note }, m);
  }

  /** Section 5.7: the payout's status from the seller's payout account, or a hold while the seller is suspended (FR-TNS-05). */
  private async createPayout(m: EntityManager, o: Order, amount: bigint): Promise<void> {
    const now = this.clock.now();
    const seller = await this.identity.getPrincipal(o.sellerId);
    const [account] = (await m.query(
      `SELECT id, status, effective_at FROM payments.payout_accounts WHERE user_id = $1 AND status IN ('active', 'cooling_off') LIMIT 1`,
      [o.sellerId],
    )) as { id: string; status: string; effective_at: Date }[];
    const held = seller.accountStatus === 'suspended';
    const status = held ? 'held' : !account ? 'waiting_account' : account.effective_at > now ? 'waiting_cooling_off' : 'pending';
    await m.getRepository(Payout).insert({
      orderId: o.id, sellerId: o.sellerId, payoutAccountId: account?.id ?? null, amount: amount.toString(), status,
      holdReason: held ? 'seller account suspended' : null, simulated: true, // no disbursement sandbox (SRS OI-4, FR-PAY-19)
    });
  }

  // ---------------------------------------------------------------- helpers

  /** The order and its escrow, locked, for one of its parties in the given role (else not-found or forbidden). */
  private async party(m: EntityManager, orderId: string, userId: string, role: 'buyer' | 'seller') {
    const r = await this.lock(m, orderId);
    if (r.o.buyerId !== userId && r.o.sellerId !== userId) throw new Problem('not-found'); // SEC-SDL-09
    if ((role === 'buyer' ? r.o.buyerId : r.o.sellerId) !== userId) throw new Problem('forbidden');
    return r;
  }

  private courierDone(o: Order): boolean {
    return o.fulfilmentStep === 'courier_pickup' && o.fulfilmentDoneAt !== null;
  }

  private async lock(m: EntityManager, orderId: string): Promise<{ o: Order; e: Escrow | null }> {
    const o = await m.getRepository(Order).findOne({ where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
    if (!o) throw new Problem('not-found');
    const e = await m.getRepository(Escrow).findOne({ where: { orderId }, lock: { mode: 'pessimistic_write' } });
    return { o, e };
  }

  private history(m: EntityManager, orderId: string, from: Escrow['state'], to: Escrow['state'], actor: 'system' | 'staff' | 'user', reason: string, relatedId: string | null, released = 0n, refunded = 0n, actorId?: string) {
    return m.getRepository(EscrowHistory).insert({
      orderId, fromState: from, toState: to, actorType: actor, actorId: actorId ?? null, reason, relatedId, amountReleased: released.toString(), amountRefunded: refunded.toString(),
    });
  }

  /** I-37: every order event carries the listing title, for the notices of Unit 6. */
  private async event(m: EntityManager, eventType: string, orderId: string, payload: Record<string, unknown>) {
    const [o] = (await m.query(`SELECT listing_snapshot->>'title' AS title FROM orders.orders WHERE id = $1`, [orderId])) as { title: string | null }[];
    return m.getRepository(OrdersOutboxEvent).insert({ eventType, aggregateId: orderId, payload: { ...payload, listingTitle: o?.title ?? null } });
  }
}
