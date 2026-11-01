import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EventBus, OutboxEvent } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import { Category, Clarification, Listing, ListingPhoto, ListingStatusChange } from '../db/entities';
import type { ListingSnapshot, ListingsPort } from '../ports';
import { publish } from './outbox';

// StockPort (docs/design/03_listings_auctions.pdf section 3.3; DC-13, I-9, I-14). Unit 2 calls reserve inside
// its checkout transaction; each call is one conditional update in the database (listings.reserve, release,
// mark_sold), so fifty buyers racing for two units get exactly two reservations (AC-2).
//
// It also consumes Unit 2's order events (DC-6): orders.order.paid turns the order's reserved units into
// sold ones, orders.order.cancelled returns them. listings.stock_moves keeps one outcome per order, so a
// redelivered event moves nothing twice, and a cancellation after payment returns nothing (I-14: the seller
// relists). Both events carry the listing and the quantity (Decisions log, U3-02). Auction listings are
// sold by the auction closer (U3-05), not here.
@Injectable()
export class StockService implements ListingsPort, OnModuleInit {
  private readonly log = new Logger('StockService');

  constructor(
    private readonly db: DataSource,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.on('orders.order.paid', 'listings.stock', (e) => this.onOrder(e, 'sold'));
    this.bus.on('orders.order.cancelled', 'listings.stock', (e) => this.onOrder(e, 'released'));
  }

  async reserve(listingId: string, qty: number, tx: EntityManager): Promise<boolean> {
    const [{ ok }] = await tx.query(`SELECT listings.reserve($1, $2) AS ok`, [listingId, qty]);
    return ok === true;
  }

  async release(listingId: string, qty: number, tx: EntityManager): Promise<void> {
    await tx.query(`SELECT listings.release($1, $2)`, [listingId, qty]);
  }

  async markSold(listingId: string, qty: number, tx: EntityManager): Promise<void> {
    const before = await tx.getRepository(Listing).findOne({ where: { id: listingId }, lock: { mode: 'pessimistic_write' } });
    if (!before) throw new Problem('not-found');
    await tx.query(`SELECT listings.mark_sold($1, $2)`, [listingId, qty]);
    const [{ status }] = await tx.query(`SELECT status FROM listings.listings WHERE id = $1`, [listingId]);
    if (before.status !== 'sold' && status === 'sold') {
      await tx.getRepository(ListingStatusChange).insert({
        listingId, fromStatus: before.status, toStatus: 'sold', actorType: 'system', actorId: null, reason: 'every unit sold',
      });
      await publish(tx, 'listings.listing.sold', listingId, { listingId, sellerId: before.sellerId, itemKind: before.itemKind });
    }
  }

  async snapshot(listingId: string, tx?: EntityManager): Promise<ListingSnapshot> {
    const m = tx ?? this.db.manager;
    const l = await m.getRepository(Listing).findOneBy({ id: listingId });
    if (!l) throw new Problem('not-found');
    const [category, photos, clarifications] = await Promise.all([
      m.getRepository(Category).findOneByOrFail({ id: l.categoryId }),
      m.getRepository(ListingPhoto).find({ where: { listingId }, order: { position: 'ASC' } }),
      m.getRepository(Clarification).find({ where: { listingId }, order: { createdAt: 'ASC', id: 'ASC' } }),
    ]);
    return {
      listingId: l.id, sellerId: l.sellerId, itemKind: l.itemKind, saleFormat: l.saleFormat, status: l.status,
      category: { id: category.id, slug: category.slug, nameEn: category.nameEn, nameBn: category.nameBn },
      title: l.title, description: l.description, condition: l.condition, noVisibleDefects: l.noVisibleDefects,
      fulfilmentOptions: l.fulfilmentOptions, weightClass: l.weightClass, sizeClass: l.sizeClass, district: l.areaDistrict,
      price: l.price,
      clarifications: clarifications.map((c) => ({ body: c.body, at: c.createdAt.toISOString() })),
      photoKeys: photos.filter((p) => p.removedAt === null).map((p) => p.storageKey),
      capturedAt: new Date().toISOString(),
    };
  }

  /** One stock outcome per order; the listing is locked first (DC-14). */
  async onOrder(e: Pick<OutboxEvent, 'aggregateId' | 'payload'>, kind: 'sold' | 'released'): Promise<void> {
    const listingId = e.payload.listingId;
    const quantity = e.payload.quantity;
    if (typeof listingId !== 'string' || !Number.isInteger(quantity) || (quantity as number) < 1) {
      throw new Error(`order event for ${e.aggregateId} lacks listingId or quantity`); // retried, then reported (K-04)
    }
    await this.db.transaction(async (m) => {
      const l = await m.getRepository(Listing).findOne({ where: { id: listingId }, lock: { mode: 'pessimistic_write' } });
      if (!l) throw new Error(`order ${e.aggregateId} names an unknown listing ${listingId}`);
      if (l.saleFormat !== 'fixed_price') return; // auctions: U3-05
      const moved: unknown[] = await m.query(
        `INSERT INTO listings.stock_moves (order_id, kind, listing_id, quantity) VALUES ($1, $2, $3, $4)
         ON CONFLICT (order_id) DO NOTHING RETURNING order_id`,
        [e.aggregateId, kind, listingId, quantity],
      );
      if (moved.length === 0) {
        this.log.debug(`order ${e.aggregateId}: stock already moved, ${kind} ignored`);
        return;
      }
      if (kind === 'sold') await this.markSold(listingId, quantity as number, m);
      else await this.release(listingId, quantity as number, m);
    });
  }
}
