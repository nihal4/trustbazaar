import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U7-08: the flagged-activity queue's signals (docs/design/07_disputes_trust_staff.pdf section 6.2; FR-OPS-01, DV-51)
// against PostgreSQL. The source events of Units 3, 4 and 6 are handed to the consumer as the outbox dispatcher would
// hand them; an operator reviews through the real security pipeline.
describe('signals', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let bus: EventBus;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const event = (type: string, aggregateId: string, payload: Record<string, unknown>, createdAt = new Date()): OutboxEvent =>
    ({ outbox: type.split('.')[0], id: String(randomInt(1, 2 ** 31)), type, aggregateId, payload, createdAt, attempt: 1 });
  const consume = async (e: OutboxEvent) => {
    const c = bus.consumersOf(e.type).find((x) => x.name === 'trust.signals');
    await c!.handler(e);
  };
  const signals = (source: string) =>
    fx.query<{ id: string; kind: string; subject_user: string | null; detail: Record<string, unknown>; status: string }>(
      `SELECT id, kind, subject_user, detail, status FROM trust.signals WHERE source_ref = $1`, [source]);
  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    const headers = fx.headers(sid, staffId, 'staff');
    return {
      staffId,
      call: (method: string, path: string, body?: unknown) => fetch(t.url(path), {
        method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
      }),
    };
  }

  it('FR-OPS-01 a shill flag, a relisting flag and a delivery issue each become one signal, however often delivered', async () => {
    const seller = await fx.user();
    const [auctionId, listingId, previous, issueId, orderId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const flagId = randomInt(1, 2 ** 31);
    const events = [
      event('auctions.flag.raised', auctionId, { auctionId, flagId, kind: 'shill_score', score: 0.82 }),
      event('listings.listing.relisting_flagged', listingId, { listingId, sellerId: seller, previousListingId: previous, similarity: 0.91 }),
      event('delivery.issue.opened', orderId, { issueId, orderId, kind: 'code_locked' }),
    ];
    for (const e of [...events, ...events]) await consume(e);
    expect(await signals(`auctions.flag:${flagId}`)).toEqual([expect.objectContaining({ kind: 'shill_bidding', subject_user: null, detail: { auctionId, flag: 'shill_score', score: 0.82 }, status: 'open' })]);
    expect(await signals(`listing:${listingId}`)).toEqual([expect.objectContaining({ kind: 'relisting', subject_user: seller, detail: { listingId, previousListingId: previous, similarity: 0.91 } })]);
    expect(await signals(`delivery.issue:${issueId}`)).toEqual([expect.objectContaining({ kind: 'delivery_issue', detail: { issueId, orderId, issue: 'code_locked' } })]);
  });

  it('DV-51 chat flags make one signal per sender per day, with the count, the flags and the threads; a message counts once', async () => {
    const [sender, other] = [await fx.user(), await fx.user()];
    const [t1, t2] = [randomUUID(), randomUUID()];
    const noon = new Date('2026-11-10T06:00:00Z'); // 12:00 in Dhaka
    const flag = (thread: string, messageId: number, flags: string[], from = sender, at = noon) => event('chat.message.flagged', thread, { messageId, flags, sender: from }, at);
    const m1 = flag(t1, 101, ['phone_number']);
    for (const e of [m1, flag(t1, 102, ['phone_number', 'payment_phrase']), m1, flag(t2, 103, ['link'])]) await consume(e);
    const [s] = await signals(`chat:${sender}:2026-11-10`);
    expect(s).toMatchObject({ kind: 'chat_flags', subject_user: sender, status: 'open' });
    expect(s.detail).toEqual({ day: '2026-11-10', count: 3, messageIds: ['101', '102', '103'], threadIds: [t1, t2], flags: { phone_number: 2, payment_phrase: 1, link: 1 } });
    await consume(flag(t1, 104, ['link'], sender, new Date('2026-11-10T19:00:00Z'))); // 01:00 on the 11th in Dhaka: the next day
    await consume(flag(t1, 105, ['link'], other));
    expect((await signals(`chat:${sender}:2026-11-11`))[0].detail).toMatchObject({ count: 1 });
    expect((await signals(`chat:${other}:2026-11-10`))[0].detail).toMatchObject({ count: 1 });
    await expect(consume(event('chat.message.flagged', t1, { messageId: 1, flags: [] }))).rejects.toThrow('no sender');
  });

  it('FR-OPS-01 FR-OPS-06 an operator dismisses or actions a signal once, with a note; never one about a user they declared a conflict with', async () => {
    const seller = await fx.user();
    const listingId = randomUUID();
    await consume(event('listings.listing.relisting_flagged', listingId, { listingId, sellerId: seller, previousListingId: randomUUID(), similarity: 0.9 }));
    const [{ id }] = await signals(`listing:${listingId}`);
    const [op, conflicted] = [await operator(), await operator()];
    expect((await conflicted.call('POST', '/staff/conflicts', { userId: seller, reason: 'A former colleague of mine.' })).status).toBe(204);
    expect((await conflicted.call('POST', `/staff/signals/${id}/review`, { outcome: 'dismissed', note: 'Looks like a normal relisting.' })).status).toBe(403);
    expect((await op.call('POST', `/staff/signals/${id}/review`, { outcome: 'dismissed', note: 'Too short' })).status).toBe(400);
    const r = await op.call('POST', `/staff/signals/${id}/review`, { outcome: 'actioned', note: 'Same phone relisted after a cancelled sale; warned.' });
    expect([r.status, await r.json()]).toEqual([200, { signalId: id, status: 'actioned' }]);
    expect((await op.call('POST', `/staff/signals/${id}/review`, { outcome: 'dismissed', note: 'Changed my mind about this.' })).status).toBe(400); // closed
    expect((await op.call('POST', `/staff/signals/${randomUUID()}/review`, { outcome: 'dismissed', note: 'Looks like a normal relisting.' })).status).toBe(404);
    expect(await fx.query(`SELECT status, reviewed_by, note FROM trust.signals WHERE id = $1`, [id]))
      .toEqual([{ status: 'actioned', reviewed_by: op.staffId, note: 'Same phone relisted after a cancelled sale; warned.' }]);
    expect(await fx.query(`SELECT action FROM audit.events WHERE object_id = $1`, [id])).toEqual([{ action: 'trust.signal.actioned' }]);
    expect((await fetch(t.url(`/staff/signals/${id}/review`), { method: 'POST' })).status).toBe(401);
  });
});
