import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { TRUST_QUERY, TrustQuery } from '../../src/modules/trust/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U7-05: ratings and the profile summary (docs/design/07_disputes_trust_staff.pdf section 7; FR-REV-01 to FR-REV-07)
// against PostgreSQL through the real security pipeline. Orders are written directly as paid; Unit 2's terminal escrow
// events are handed to the consumer as the outbox dispatcher would hand them.
describe('ratings and the profile summary', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let bus: EventBus;
  let summary: TrustQuery;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    summary = t.app.get<TrustQuery>(TRUST_QUERY);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const DAY = 86_400_000;
  const call = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) =>
    fetch(t.url(path), {
      method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    return { userId, call: call({ ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip }) };
  }
  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    return { staffId, call: call(fx.headers(sid, staffId, 'staff')) };
  }
  async function order(buyerId: string, sellerId: string) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 100000, 100000, 'self_pickup', 0, 100000, '{"title":"Item"}', 500, 1000, 1, now(), 'paid', now(), 'meetup_handover', now() + interval '3 days')
       RETURNING id`,
      [randomUUID(), buyerId, sellerId],
    );
    return id;
  }
  /** The order's escrow reached a terminal state `daysAgo` days ago (Unit 2's event). */
  async function closed(orderId: string, buyerId: string, sellerId: string, state: 'released' | 'refunded' | 'partially_refunded' = 'released', daysAgo = 0) {
    const e: OutboxEvent = {
      outbox: 'orders', id: String(randomInt(1, 2 ** 31)), type: `orders.escrow.${state}`, aggregateId: orderId,
      payload: { orderId, buyerId, sellerId, reason: null, refunded: '0', sellerPayout: '95000' }, createdAt: new Date(Date.now() - daysAgo * DAY), attempt: 1,
    };
    const c = bus.consumersOf(e.type).find((x) => x.name === 'trust.ratings');
    await c!.handler(e);
  }
  /** A finished, released order between the two. */
  async function deal(buyer: { userId: string }, seller: { userId: string }, state: 'released' | 'refunded' | 'partially_refunded' = 'released') {
    const id = await order(buyer.userId, seller.userId);
    await closed(id, buyer.userId, seller.userId, state);
    return id;
  }
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;
  const anonymous = call({ 'x-forwarded-for': `198.51.100.${randomInt(1, 255)}` });

  it('FR-REV-01 FR-REV-02 only the parties of a paid, finished order rate each other, once each, 1 to 5 stars', async () => {
    const [buyer, seller, stranger] = [await member(), await member(), await member()];
    const unfinished = await order(buyer.userId, seller.userId);
    expect((await buyer.call('POST', `/orders/${unfinished}/rating`, { stars: 5 })).status).toBe(404); // no terminal escrow state yet
    const id = await deal(buyer, seller);
    await closed(id, buyer.userId, seller.userId); // redelivered: one eligibility row
    expect(await fx.query(`SELECT completed, rate_until - closed_at = interval '14 days' AS cp39 FROM trust.rating_eligibility WHERE order_id = $1`, [id])).toEqual([{ completed: true, cp39: true }]);

    const r = await buyer.call('POST', `/orders/${id}/rating`, { stars: 5, text: '  Exactly as described, quick handover.  ' });
    expect(r.status).toBe(201);
    const view = (await r.json()) as { id: string; stars: number; text: string; editableUntil: string; reply: null };
    expect(view).toMatchObject({ stars: 5, text: 'Exactly as described, quick handover.', reply: null });
    expect(new Date(view.editableUntil).getTime() - Date.now()).toBeGreaterThan(47 * 3_600_000); // CP-39: 48 hours
    expect((await seller.call('POST', `/orders/${id}/rating`, { stars: 4 })).status).toBe(201); // the other direction
    expect(await errors(await buyer.call('POST', `/orders/${id}/rating`, { stars: 1 }))).toEqual([{ field: 'order', reason: 'already-rated' }]);
    expect((await stranger.call('POST', `/orders/${id}/rating`, { stars: 1 })).status).toBe(404);
    for (const stars of [0, 6, 2.5]) expect((await stranger.call('POST', `/orders/${id}/rating`, { stars })).status).toBe(400);
    expect((await anonymous('POST', `/orders/${id}/rating`, { stars: 5 })).status).toBe(401);
    expect(await fx.query(`SELECT rater_id, ratee_id FROM trust.ratings WHERE order_id = $1 ORDER BY created_at`, [id]))
      .toEqual([{ rater_id: buyer.userId, ratee_id: seller.userId }, { rater_id: seller.userId, ratee_id: buyer.userId }]);
  });

  it('FR-REV-01 CP-39 the rating window is 14 days from the close', async () => {
    const [buyer, seller] = [await member(), await member()];
    const id = await order(buyer.userId, seller.userId);
    await closed(id, buyer.userId, seller.userId, 'refunded', 15);
    expect(await errors(await buyer.call('POST', `/orders/${id}/rating`, { stars: 3 }))).toEqual([{ field: 'order', reason: 'rating-window-ended' }]);
  });

  it('FR-REV-03 the rater edits a rating within 48 hours; afterwards it is fixed', async () => {
    const [buyer, seller] = [await member(), await member()];
    const id = await deal(buyer, seller);
    const { id: ratingId } = (await (await buyer.call('POST', `/orders/${id}/rating`, { stars: 2, text: 'Late to the meeting.' })).json()) as { id: string };
    const edited = await buyer.call('PATCH', `/ratings/${ratingId}`, { stars: 4 });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ stars: 4, text: 'Late to the meeting.', editedAt: expect.any(String) });
    expect(await (await buyer.call('PATCH', `/ratings/${ratingId}`, { text: '' })).json()).toMatchObject({ stars: 4, text: null });
    expect((await seller.call('PATCH', `/ratings/${ratingId}`, { stars: 1 })).status).toBe(404); // not the rater

    const other = await deal(buyer, seller);
    const [{ id: old }] = await fx.query<{ id: string }>(
      `INSERT INTO trust.ratings (order_id, rater_id, ratee_id, stars, edit_until, created_at) VALUES ($1, $2, $3, 3, now() - interval '1 hour', now() - interval '49 hours') RETURNING id`,
      [other, buyer.userId, seller.userId]);
    expect(await errors(await buyer.call('PATCH', `/ratings/${old}`, { stars: 5 }))).toEqual([{ field: 'rating', reason: 'edit-period-ended' }]);
  });

  it('FR-REV-06 the rated user posts one reply to a written review', async () => {
    const [buyer, seller] = [await member(), await member()];
    const id = await deal(buyer, seller);
    const { id: written } = (await (await buyer.call('POST', `/orders/${id}/rating`, { stars: 2, text: 'The box was damaged.' })).json()) as { id: string };
    const { id: starsOnly } = (await (await seller.call('POST', `/orders/${id}/rating`, { stars: 5 })).json()) as { id: string };
    expect((await buyer.call('POST', `/ratings/${written}/reply`, { text: 'Replying to myself.' })).status).toBe(404); // not the rated user
    const r = await seller.call('POST', `/ratings/${written}/reply`, { text: 'Sorry, the courier dropped it; I offered a discount.' });
    expect([r.status, ((await r.json()) as { reply: { text: string } }).reply.text]).toEqual([200, 'Sorry, the courier dropped it; I offered a discount.']);
    expect(await errors(await seller.call('POST', `/ratings/${written}/reply`, { text: 'A second reply.' }))).toEqual([{ field: 'rating', reason: 'already-replied' }]);
    expect(await errors(await buyer.call('POST', `/ratings/${starsOnly}/reply`, { text: 'Thanks!' }))).toEqual([{ field: 'rating', reason: 'no-text-to-answer' }]);
    expect(await errors(await buyer.call('PATCH', `/ratings/${written}`, { text: null }))).toEqual([{ field: 'text', reason: 'has-a-reply' }]);
  });

  it('FR-REV-04 FR-REV-05 FR-REV-07 the summary counts ratings not removed and released deals only; an operator removes a review with a reason', async () => {
    const seller = await member();
    const [b1, b2, b3] = [await member(), await member(), await member()];
    const ids = [await deal(b1, seller), await deal(b2, seller), await deal(b3, seller, 'refunded')];
    await b1.call('POST', `/orders/${ids[0]}/rating`, { stars: 5, text: 'Great seller.' });
    const { id: harsh } = (await (await b2.call('POST', `/orders/${ids[1]}/rating`, { stars: 2, text: 'Call him on 01711-000000, he is a cheat!' })).json()) as { id: string };
    await b3.call('POST', `/orders/${ids[2]}/rating`, { stars: 3 }); // a refunded order can be rated, but is not a completed transaction
    const trust = await anonymous('GET', `/users/${seller.userId}/trust`);
    expect([trust.status, await trust.json()]).toEqual([200, { userId: seller.userId, averageRating: 3.3, ratingCount: 3, completedTransactions: 2, badges: { verified: true, pro: false } }]);
    expect(await summary.profileSummary(b1.userId)).toEqual({ averageRating: null, ratingCount: 0, completedTransactions: 1 });
    expect(await summary.profileSummary(randomUUID())).toEqual({ averageRating: null, ratingCount: 0, completedTransactions: 0 });

    const op = await operator();
    expect((await op.call('POST', `/staff/ratings/${harsh}/removal`, { reason: 'Too short' })).status).toBe(400);
    expect(await (await op.call('POST', `/staff/ratings/${harsh}/removal`, { reason: 'Contains a phone number and abuse.' })).json()).toEqual({ ratingId: harsh, removed: true });
    expect((await op.call('POST', `/staff/ratings/${harsh}/removal`, { reason: 'Contains a phone number and abuse.' })).status).toBe(404); // final
    expect((await b2.call('POST', `/staff/ratings/${harsh}/removal`, { reason: 'Contains a phone number and abuse.' })).status).toBe(401);
    expect(await (await anonymous('GET', `/users/${seller.userId}/trust`)).json()).toMatchObject({ averageRating: 4, ratingCount: 2 });
    expect((await b2.call('PATCH', `/ratings/${harsh}`, { stars: 3 })).status).toBe(404); // removed: fixed
    expect(await fx.query(`SELECT action, reason FROM audit.events WHERE object_id = $1`, [harsh])).toEqual([{ action: 'trust.rating.removed', reason: 'Contains a phone number and abuse.' }]);
    const page = (await (await anonymous('GET', `/users/${seller.userId}/ratings`)).json()) as { items: { id: string; by: string; stars: number }[] };
    expect(page.items.map((i) => [i.stars, i.by])).toEqual([[3, 'buyer'], [5, 'buyer']]);
    expect((await anonymous('GET', `/users/${randomUUID()}/trust`)).status).toBe(404);
  });

  it('FR-REV-04 the reviews page newest first, 20 at a time, with "Closed account" for a rater who left', async () => {
    const buyer = await member();
    const raters: string[] = [];
    for (let i = 0; i < 21; i++) {
      const seller = await member();
      const id = await deal(buyer, seller);
      expect((await seller.call('POST', `/orders/${id}/rating`, { stars: 1 + (i % 5), text: `Review ${i}` })).status).toBe(201);
      raters.push(seller.userId);
    }
    await fx.query(`UPDATE identity.users SET account_status = 'closed', closed_at = now() WHERE id = $1`, [raters[20]]);
    type Page = { items: { text: string; by: string; rater: { displayName: string } | null; reply: null; edited: boolean }[]; nextCursor: string | null };
    const first = (await (await anonymous('GET', `/users/${buyer.userId}/ratings`)).json()) as Page;
    expect(first.items).toHaveLength(20);
    expect(first.items[0]).toEqual({ id: expect.any(String), stars: 1, text: 'Review 20', at: expect.any(String), edited: false, by: 'seller', rater: null, reply: null });
    expect(first.items[1].rater).toEqual({ displayName: 'Test user' });
    const second = (await (await anonymous('GET', `/users/${buyer.userId}/ratings?cursor=${first.nextCursor}`)).json()) as Page;
    expect([second.items.map((i) => i.text), second.nextCursor]).toEqual([['Review 0'], null]);
    expect((await anonymous('GET', `/users/${buyer.userId}/ratings?cursor=bm9wZQ`)).status).toBe(400);
  });
});
