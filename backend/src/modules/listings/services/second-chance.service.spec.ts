import { parameterValues, type ConfigPort } from '../../../kernel/config-port';
import { EventBus } from '../../../kernel/events/event-bus';
import { Problem } from '../../../kernel/http/problems';
import type { AuditServicePort, IdentityQuery } from '../../identity/ports';
import type { AuctionOrders } from '../adapters/orders';
import { SecondChanceService } from './second-chance.service';

// Unit tests of SecondChanceService over a scripted stand-in for the database: strikes, the offer chain, decisions
// and expiry. test/api/auction-close.spec.ts runs the same flows on PostgreSQL with Unit 2's order service.

const AUCTION = '7b1c2a3e-1111-4a5b-8c9d-000000000001';
const OFFER = '7b1c2a3e-2222-4a5b-8c9d-000000000002';

interface Script {
  struck?: boolean;
  restricted?: boolean;
  next?: { bidder: string | null; price: string | null };
  offer?: { bidder_id: string; status: string; expired: boolean } | null;
  due?: { id: string; auction_id: string }[];
  locked?: boolean;
}

function setup(s: Script = {}) {
  const sql: { q: string; p: unknown[] }[] = [];
  const inserted: { eventType: string; payload: Record<string, unknown> }[] = [];
  const query = async (q: string, p: unknown[] = []) => {
    sql.push({ q, p });
    if (q.includes('SKIP LOCKED')) return s.locked === false ? [] : [{ x: 1 }];
    if (q.includes('FROM auctions.auctions WHERE listing_id = $1 FOR UPDATE')) return s.locked === false ? [] : [{ x: 1 }];
    if (q.includes('FROM auctions.strikes WHERE order_id')) return s.struck ? [{ x: 1 }] : [];
    if (q.includes('record_strike')) return [{ restricted: s.restricted ?? false }];
    if (q.includes('FROM auctions.bidding_restrictions')) return [{ until: new Date('2026-12-01T00:00:00Z') }];
    if (q.includes('next_second_chance')) return [s.next ?? { bidder: 'babu', price: '120000' }];
    if (q.includes('INSERT INTO auctions.second_chance_offers')) return [{ id: OFFER, expires_at: new Date('2026-11-03T00:00:00Z') }];
    if (q.includes('FROM auctions.second_chance_offers') && q.includes('FOR UPDATE')) {
      return s.offer === null ? [] : [{ id: OFFER, auction_id: AUCTION, price: '120000', ...(s.offer ?? { bidder_id: 'babu', status: 'offered', expired: false }) }];
    }
    if (q.includes("status = 'offered' AND expires_at <= now()")) return s.due ?? [];
    if (q.includes('FROM listings.listings WHERE id = $1 FOR UPDATE')) return [{ seller_id: 'seller', item_kind: 'physical', status: 'active' }];
    return [];
  };
  const manager = { query, getRepository: () => ({ insert: async (row: never) => void inserted.push(row) }) };
  const db = { query, transaction: async (fn: (m: typeof manager) => unknown) => fn(manager) };
  const bus = new EventBus();
  const orders = { createAuctionOrder: jest.fn(async () => ({ id: 'order-2' })) };
  const identity = { assertCanTransact: jest.fn(async () => undefined) };
  const audit = { record: jest.fn(async () => undefined) };
  const values = parameterValues({ 'CP-11': '24 hours', 'CP-12': { strikes: 2, window: '90 days', suspension: '30 days' } });
  const params = { current: async () => ({ ...values, version: 1 }) } as unknown as ConfigPort;
  const svc = new SecondChanceService(
    db as never, bus, orders as unknown as AuctionOrders, identity as unknown as IdentityQuery, audit as unknown as AuditServicePort, params,
  );
  svc.onModuleInit();
  return { svc, sql, inserted, bus, orders, identity, audit, ran: (part: string) => sql.some((x) => x.q.includes(part)) };
}

const expired = (o: Record<string, unknown> = {}) => ({ aggregateId: 'order-1', payload: { kind: 'auction', listingId: AUCTION, buyerId: 'asha', ...o } });

describe('SecondChanceService', () => {
  it('FR-AUC-16 an unpaid auction order gives a strike under CP-12 and offers the next bidder for CP-11', async () => {
    const t = setup();
    expect(t.bus.consumersOf('orders.order.payment_expired')).toHaveLength(1);
    await t.svc.onPaymentExpired(expired());
    expect(t.sql.find((x) => x.q.includes('record_strike'))?.p).toEqual(['asha', AUCTION, 'order-1', 2, '90 days', '30 days']);
    expect(t.sql.find((x) => x.q.includes('INSERT INTO auctions.second_chance_offers'))?.p).toEqual([AUCTION, 'babu', '120000', 86_400_000]);
    expect(t.inserted.map((e) => e.eventType)).toEqual(['auctions.offer.made']);
    expect(t.audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auctions.strike.recorded', objectId: 'asha' }), expect.anything());
  });

  it('FR-AUC-16 reaching the threshold restricts bidding and tells the bidder until when', async () => {
    const t = setup({ restricted: true });
    await t.svc.onPaymentExpired(expired());
    expect(t.inserted[0]).toMatchObject({ eventType: 'auctions.bidder.restricted', payload: { userId: 'asha', until: '2026-12-01T00:00:00.000Z' } });
  });

  it('FR-AUC-15 a redelivered event, a fixed-price order or a malformed event changes nothing', async () => {
    const t = setup({ struck: true });
    await t.svc.onPaymentExpired(expired());
    expect(t.ran('record_strike')).toBe(false);
    await t.svc.onPaymentExpired(expired({ kind: 'fixed_price' }));
    await expect(t.svc.onPaymentExpired(expired({ buyerId: undefined }))).rejects.toThrow('lacks listingId or buyerId');
    await expect(setup({ locked: false }).svc.onPaymentExpired(expired())).rejects.toThrow('no auction');
  });

  it('FR-AUC-15 with nobody left the unit is released and the listing ends unsold', async () => {
    const t = setup({ next: { bidder: null, price: null } });
    await t.svc.onPaymentExpired(expired({ kind: 'second_chance' }));
    expect(t.ran('listings.release($1, 1)')).toBe(true);
    expect(t.inserted.filter((e) => e.eventType).map((e) => e.eventType)).toEqual(['listings.listing.ended_unsold']);
  });

  it('FR-AUC-15 accepting checks the account again and creates the second_chance order', async () => {
    const t = setup();
    expect(await t.svc.decide('babu', AUCTION, OFFER, 'accept')).toEqual({ offerId: OFFER, status: 'accepted', orderId: 'order-2' });
    expect(t.identity.assertCanTransact).toHaveBeenCalledWith('babu', 'buy');
    expect(t.orders.createAuctionOrder).toHaveBeenCalledWith({ listingId: AUCTION, winnerId: 'babu', price: 120000n, kind: 'second_chance' }, expect.anything());
    expect(t.sql.find((x) => x.q.includes(`status = 'accepted'`))?.p).toEqual([OFFER, 'order-2']);
  });

  it('FR-AUC-15 declining passes the item to the next bidder', async () => {
    const t = setup({ next: { bidder: 'chaya', price: '110000' } });
    expect(await t.svc.decide('babu', AUCTION, OFFER, 'decline')).toEqual({ offerId: OFFER, status: 'declined', orderId: null });
    expect(t.identity.assertCanTransact).not.toHaveBeenCalled();
    expect(t.inserted[0]).toMatchObject({ eventType: 'auctions.offer.made', payload: { userId: 'chaya', price: '110000' } });
  });

  it('FR-AUC-15 another user, an unknown offer, a decided or expired one are refused', async () => {
    const problem = (p: Promise<unknown>) => p.then(() => 'none', (e: Problem) => e.problem);
    expect(await problem(setup().svc.decide('chaya', AUCTION, OFFER, 'accept'))).toBe('not-found');
    expect(await problem(setup({ offer: null }).svc.decide('babu', AUCTION, OFFER, 'decline'))).toBe('not-found');
    expect(await problem(setup({ offer: { bidder_id: 'babu', status: 'declined', expired: false } }).svc.decide('babu', AUCTION, OFFER, 'decline'))).toBe('offer-closed');
    expect(await problem(setup({ offer: { bidder_id: 'babu', status: 'offered', expired: true } }).svc.decide('babu', AUCTION, OFFER, 'accept'))).toBe('offer-closed');
  });

  it('FR-AUC-15 the job expires due offers and offers the next bidder; one decided meanwhile is left alone', async () => {
    const t = setup({ due: [{ id: OFFER, auction_id: AUCTION }], offer: { bidder_id: 'babu', status: 'offered', expired: true } });
    expect(await t.svc.expireDue()).toBe(1);
    expect(t.inserted.map((e) => e.eventType)).toEqual(['auctions.offer.expired', 'auctions.offer.made']);
    const decided = setup({ due: [{ id: OFFER, auction_id: AUCTION }], offer: { bidder_id: 'babu', status: 'accepted', expired: true } });
    expect(await decided.svc.expireDue()).toBe(0);
    expect(await setup({ due: [{ id: OFFER, auction_id: AUCTION }], locked: false }).svc.expireDue()).toBe(0);
  });
});
