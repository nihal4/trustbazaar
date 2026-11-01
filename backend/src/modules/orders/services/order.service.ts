import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CLOCK, Clock } from '../../../kernel/clock';
import { CONFIG_PORT, ConfigPort, ParameterValues } from '../../../kernel/config-port';
import { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { Problem } from '../../../kernel/http/problems';
import { AUDIT_SERVICE, AuditServicePort, IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { LISTINGS_PORT, ListingSnapshot, ListingsPort } from '../../listings/ports';
import { Escrow, Order, OrdersOutboxEvent } from '../db/entities';
import type { Fulfilment, OrderView, OrdersPort } from '../ports';

// Orders (docs/design/02_orders_payments.pdf sections 5.3 and 5.4; FR-FIX-01, 02, 05, FR-TNS-07; I-52).
//
// Fixed-price checkout is one transaction (DC-13): the buyer's open-order total is locked first (an advisory
// lock per buyer, so two parallel checkouts cannot both slip under CP-27), then Listings reserves the units
// with one conditional update, which also locks the listing (DC-14: listing before order); the snapshot is
// read after that lock, so the order records exactly the terms that were reserved. Nothing the client sends
// is a price (SEC-PAY-06): the unit price comes from the listing, the fee rates from the parameter version,
// which is stored on the order (FR-OPS-08).
//
// Until Unit 4 issues delivery quotes and Unit 5 checks a game-account buyer's key (Decisions log, U2-02),
// checkout offers self pickup only: courier and game-account orders answer feature-off. Auction orders are
// created by Unit 3 through OrdersPort, with the fulfilment chosen later.

const PAGE = 50;
const OPTIONS: Record<string, Fulfilment[]> = {
  pickup_only: ['self_pickup'],
  courier_only: ['courier'],
  pickup_or_courier: ['self_pickup', 'courier'],
};
const optionsOf = (s: ListingSnapshot): Fulfilment[] => (s.itemKind === 'game_account' ? ['game_account'] : OPTIONS[s.fulfilmentOptions ?? ''] ?? []);

interface Cp27 {
  new_days: number;
  new_per_order: number;
  new_open: number;
  per_order: number;
}

/** The fulfilment methods checkout can take today; the others wait for their units (Decisions log, U2-02). */
export function fulfilmentRefusal(f: Fulfilment, options: Fulfilment[]): string | null {
  if (!options.includes(f)) return 'not-offered-by-listing';
  if (f === 'courier') return 'courier-not-yet-available'; // Unit 4 DeliveryPort.claimQuote (I-21)
  if (f === 'game_account') return 'game-accounts-not-yet-available'; // Unit 5 GameAccountPort (I-29)
  return null;
}

@Injectable()
export class OrderService implements OrdersPort {
  constructor(
    private readonly db: DataSource,
    private readonly idempotency: IdempotencyKeys,
    @Inject(LISTINGS_PORT) private readonly listings: ListingsPort,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditServicePort,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------- fixed-price checkout (section 5.3)

  async checkout(
    buyerId: string,
    c: { listingId: string; quantity: number; fulfilment?: Fulfilment },
    idempotencyKey: string | undefined,
  ): Promise<{ order: OrderView; repeated: boolean }> {
    const { id, repeated } = await this.idempotency.once('order', buyerId, idempotencyKey, async () => {
      if (!(await this.params.switchOn('SW-new_orders'))) throw new Problem('feature-off'); // SEC-IRM-04
      const params = await this.params.current();
      // read before the transaction: inside it, a second pool connection could starve under a burst (FR-FIX-05)
      const { verifiedAt } = await this.identity.getPrincipal(buyerId);
      return this.db.transaction(async (m) => {
        await m.query(`SELECT pg_advisory_xact_lock(hashtextextended('orders.checkout:' || $1, 0))`, [buyerId]);
        // FR-FIX-02, FR-FIX-05: one conditional update; false is a definite "not available"
        if (!(await this.listings.reserve(c.listingId, c.quantity, m))) throw new Problem('not-available');
        const snap = await this.listings.snapshot(c.listingId, m);
        if (snap.sellerId === buyerId) throw new Problem('forbidden', { errors: [{ field: 'listingId', reason: 'own-listing' }] }); // FR-FIX-01
        if (snap.itemKind === 'game_account') {
          throw new Problem('feature-off', { errors: [{ field: 'listingId', reason: 'game-accounts-not-yet-available' }] });
        }
        if (c.fulfilment) {
          const refusal = fulfilmentRefusal(c.fulfilment, optionsOf(snap));
          if (refusal) throw new Problem(refusal === 'not-offered-by-listing' ? 'validation-failed' : 'feature-off', { errors: [{ field: 'fulfilment', reason: refusal }] });
        }
        const unitPrice = BigInt(snap.price!);
        const itemPrice = unitPrice * BigInt(c.quantity);
        await this.assertWithinLimits(m, buyerId, verifiedAt, itemPrice, params);
        const now = this.clock.now();
        return this.insert(m, {
          kind: 'fixed_price', snap, buyerId, quantity: c.quantity, unitPrice, fulfilment: c.fulfilment ?? null,
          paymentDueAt: new Date(now.getTime() + params.ms('CP-13')), params, version: params.version, actor: { type: 'user', id: buyerId },
        });
      });
    });
    return { order: await this.getOrderForParty(id, buyerId), repeated };
  }

  /** FR-TNS-07, CP-27: per order for everyone; for buyers verified fewer than new_days ago also the open total. */
  private async assertWithinLimits(m: EntityManager, buyerId: string, verifiedAt: Date | null, total: bigint, params: ParameterValues): Promise<void> {
    const cp = params.get<Cp27>('CP-27');
    const isNew = !verifiedAt || this.clock.now().getTime() - verifiedAt.getTime() < cp.new_days * 86_400_000;
    const refuse = (reason: string) => {
      throw new Problem('order-limit', { errors: [{ field: 'total', reason }] });
    };
    if (total > BigInt(cp.per_order)) refuse('above-per-order-limit');
    if (!isNew) return;
    if (total > BigInt(cp.new_per_order)) refuse('above-new-account-per-order-limit');
    const [{ open }] = await m.query(
      `SELECT coalesce(sum(total), 0)::text AS open FROM orders.orders WHERE buyer_id = $1 AND status IN ('awaiting_payment', 'paid')`,
      [buyerId],
    );
    if (BigInt(open) + total > BigInt(cp.new_open)) refuse('above-new-account-open-limit');
  }

  /** FR-DLV-02: the buyer chooses the method before paying (needed for auction orders, which start without one). */
  async chooseFulfilment(buyerId: string, orderId: string, fulfilment: Fulfilment): Promise<OrderView> {
    await this.db.transaction(async (m) => {
      const o = await m.getRepository(Order).findOne({ where: { id: orderId }, lock: { mode: 'pessimistic_write' } });
      if (!o || (o.buyerId !== buyerId && o.sellerId !== buyerId)) throw new Problem('not-found');
      if (o.buyerId !== buyerId) throw new Problem('forbidden'); // the seller sees the order, the buyer chooses
      if (o.status !== 'awaiting_payment') throw new Problem('order-state');
      const refusal = fulfilmentRefusal(fulfilment, optionsOf(o.listingSnapshot as ListingSnapshot));
      if (refusal) throw new Problem(refusal === 'not-offered-by-listing' ? 'validation-failed' : 'feature-off', { errors: [{ field: 'fulfilment', reason: refusal }] });
      // self pickup has no fee, so the total is the item price (constraints fee_only_for_courier, total_matches)
      await m.getRepository(Order).update({ id: orderId }, { fulfilment, deliveryQuoteId: null, deliveryFee: '0', total: o.itemPrice });
    });
    return this.getOrderForParty(orderId, buyerId);
  }

  // ---------------------------------------------------------------- OrdersPort (section 3.3)

  async createAuctionOrder(a: { listingId: string; winnerId: string; price: bigint; kind: 'auction' | 'second_chance' }, tx?: EntityManager): Promise<OrderView> {
    const params = await this.params.current();
    const create = async (m: EntityManager) => {
      const snap = await this.listings.snapshot(a.listingId, m);
      if (snap.saleFormat !== 'auction') throw new Error(`listing ${a.listingId} is not an auction`);
      const window = params.ms(a.kind === 'auction' ? 'CP-10' : 'CP-11'); // FR-AUC-14, FR-AUC-15
      return this.insert(m, {
        kind: a.kind, snap, buyerId: a.winnerId, quantity: 1, unitPrice: a.price, fulfilment: null,
        paymentDueAt: new Date(this.clock.now().getTime() + window), params, version: params.version, actor: { type: 'system', id: null },
      });
    };
    const id = tx ? await create(tx) : await this.db.transaction(create);
    return this.view(tx ?? this.db.manager, id, a.winnerId);
  }

  getOrderForParty(orderId: string, userId: string): Promise<OrderView> {
    return this.view(this.db.manager, orderId, userId);
  }

  // ---------------------------------------------------------------- my orders

  async list(userId: string, role: 'buyer' | 'seller', cursor: string | undefined) {
    let after: { at: string; id: string } | null = null;
    if (cursor) {
      const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
      if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) throw new Problem('validation-failed', { errors: [{ field: 'cursor', reason: 'format' }] });
      after = { at, id };
    }
    const column = role === 'seller' ? 'seller_id' : 'buyer_id';
    const rows: { id: string; created_at: Date }[] = await this.db.query(
      `SELECT id, created_at FROM orders.orders
       WHERE ${column} = $1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
       ORDER BY created_at DESC, id DESC LIMIT ${PAGE + 1}`,
      [userId, after?.at ?? null, after?.id ?? null],
    );
    const page = rows.slice(0, PAGE);
    const items = await Promise.all(page.map((r) => this.view(this.db.manager, r.id, userId)));
    const last = page[page.length - 1];
    return {
      items,
      nextCursor: rows.length > PAGE && last ? Buffer.from(`${last.created_at.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async insert(
    m: EntityManager,
    o: {
      kind: 'fixed_price' | 'auction' | 'second_chance'; snap: ListingSnapshot; buyerId: string; quantity: number; unitPrice: bigint;
      fulfilment: Fulfilment | null; paymentDueAt: Date; params: ParameterValues; version: number; actor: { type: 'user' | 'system'; id: string | null };
    },
  ): Promise<string> {
    const itemPrice = o.unitPrice * BigInt(o.quantity);
    const { identifiers } = await m.getRepository(Order).insert({
      kind: o.kind, listingId: o.snap.listingId, itemKind: o.snap.itemKind, buyerId: o.buyerId, sellerId: o.snap.sellerId,
      quantity: o.quantity, unitPrice: o.unitPrice.toString(), itemPrice: itemPrice.toString(), fulfilment: o.fulfilment,
      deliveryFee: '0', total: itemPrice.toString(), listingSnapshot: o.snap,
      // FR-MON-10: the rates of the day are kept on the order; Pro Seller's rate arrives with ProStatusQuery (U2-06)
      commissionBps: o.params.get<{ standard_bps: number }>('CP-25').standard_bps,
      deliveryMarginBps: o.params.get<number>('CP-26'),
      paramsVersion: o.version, paymentDueAt: o.paymentDueAt,
    });
    const orderId = identifiers[0].id as string;
    await m.getRepository(OrdersOutboxEvent).insert({
      eventType: 'orders.order.created', aggregateId: orderId,
      payload: { orderId, kind: o.kind, listingId: o.snap.listingId, buyerId: o.buyerId, sellerId: o.snap.sellerId, quantity: o.quantity, total: itemPrice.toString() },
    });
    await this.audit.record(
      { actorType: o.actor.type, actorId: o.actor.id, action: 'orders.order.created', objectType: 'order', objectId: orderId,
        after: { kind: o.kind, listingId: o.snap.listingId, quantity: o.quantity, total: itemPrice.toString(), paramsVersion: o.version } },
      m,
    );
    return orderId;
  }

  private async view(m: EntityManager, orderId: string, userId: string): Promise<OrderView> {
    const o = await m.getRepository(Order).findOneBy({ id: orderId });
    if (!o || (o.buyerId !== userId && o.sellerId !== userId)) throw new Problem('not-found'); // SEC-SDL-09
    const e = await m.getRepository(Escrow).findOneBy({ orderId });
    const snap = o.listingSnapshot as ListingSnapshot;
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return {
      id: o.id, kind: o.kind, role: o.buyerId === userId ? 'buyer' : 'seller', status: o.status,
      listing: { id: o.listingId, title: snap.title, itemKind: o.itemKind, photoKey: snap.photoKeys?.[0] ?? null },
      buyerId: o.buyerId, sellerId: o.sellerId, quantity: o.quantity,
      unitPrice: o.unitPrice, itemPrice: o.itemPrice, deliveryFee: o.deliveryFee, total: o.total,
      fulfilment: o.fulfilment, fulfilmentOptions: optionsOf(snap),
      paymentDueAt: o.paymentDueAt.toISOString(), paidAt: iso(o.paidAt), fulfilmentStep: o.fulfilmentStep,
      fulfilmentDueAt: iso(o.fulfilmentDueAt), deliveryEventAt: iso(o.deliveryEventAt), cancelledAt: iso(o.cancelledAt),
      cancelReason: o.cancelReason, closedAt: iso(o.closedAt), createdAt: o.createdAt.toISOString(),
      escrow: e && {
        state: e.state, releasePolicy: e.releasePolicy, amountCollected: e.amountCollected, amountRefunded: e.amountRefunded,
        disputeWindowEndsAt: iso(e.disputeWindowEndsAt), autoReleaseAt: iso(e.autoReleaseAt),
      },
    };
  }
}
