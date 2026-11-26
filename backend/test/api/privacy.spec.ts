import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { PrivacyService } from '../../src/modules/trust/services/privacy.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U7-07: lawful disclosure with four-eyes approval and the user's notice (FR-PRV-06), and the retention of dispute case
// files (I-63), against PostgreSQL through the real security pipeline. Events are handed to their consumers as the
// outbox dispatcher would hand them.
describe('privacy: lawful disclosure and case-file retention', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let bus: EventBus;
  let category: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`,
      [`privacy-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const call = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) => fetch(t.url(path), {
    method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const headers = { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}` };
    const upload = async (path: string, bytes: Buffer) => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'evidence');
      return fetch(t.url(path), { method: 'POST', headers, body: form });
    };
    return { userId, call: call(headers), upload, open: (url: string) => fetch(t.url(url.replace(/^\/api\/v1/, '')), { headers }) };
  }
  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    return { staffId, call: call(fx.headers(sid, staffId, 'staff')) };
  }
  const request = (userId: string, extra: Record<string, unknown> = {}) => ({
    userId, authority: 'Police, Cyber Crime Unit', legalReference: 'GD 1234/2026', scope: 'Orders and chat with the complainant in October.', notifyUser: true, ...extra,
  });
  const consume = async (e: OutboxEvent) => bus.consumersOf(e.type).find((c) => c.name === 'trust.privacy')!.handler(e);
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;

  it('FR-PRV-06 a lawful request is recorded, disclosed only after a second staff member approves, and the user is told', async () => {
    const user = await member();
    const [op, second] = [await operator(), await operator()];
    const r = await op.call('POST', '/staff/disclosures', request(user.userId));
    expect(r.status).toBe(202);
    const { disclosureId, approvalId, status } = (await r.json()) as { disclosureId: string; approvalId: string; status: string };
    expect(status).toBe('proposed');
    expect(await (await op.call('GET', `/staff/disclosures/${disclosureId}`)).json()).toMatchObject({ status: 'proposed', disclosedAt: null, approvalId: null, requestedBy: op.staffId });
    expect((await op.call('POST', `/staff/approvals/${approvalId}/decision`, { decision: 'approved' })).status).toBe(403); // not one's own
    expect((await second.call('POST', `/staff/approvals/${approvalId}/decision`, { decision: 'approved' })).status).toBe(200);
    expect(await (await op.call('GET', `/staff/disclosures/${disclosureId}`)).json()).toMatchObject({
      status: 'disclosed', approvalId, userNotifiedAt: expect.any(String), withheldReason: null,
    });
    const [{ payload }] = await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM disputes.outbox WHERE aggregate_id = $1 AND event_type = 'staff.disclosure.made'`, [disclosureId]);
    expect(payload).toEqual({ disclosureId, userId: user.userId, authority: 'Police, Cyber Crime Unit' });
    const e: OutboxEvent = { outbox: 'disputes', id: '1', type: 'staff.disclosure.made', aggregateId: disclosureId, payload, createdAt: new Date(), attempt: 1 };
    await consume(e);
    await consume(e); // redelivered: one notice (dedupe key)
    expect(await fx.query(`SELECT template_code, params FROM notify.notifications WHERE user_id = $1 AND template_code = 'privacy.disclosure_notice'`, [user.userId]))
      .toEqual([{ template_code: 'privacy.disclosure_notice', params: { authority: 'Police, Cyber Crime Unit' } }]);
    expect((await fx.query<{ action: string }>(`SELECT action FROM audit.events WHERE object_id = $1 AND action LIKE 'staff.disclosure.%' ORDER BY id`, [user.userId])).map((a) => a.action))
      .toEqual(['staff.disclosure.requested', 'staff.disclosure.approved']);
  });

  it('FR-PRV-06 where the law forbids telling the user, the reason is recorded instead and no notice goes out', async () => {
    const user = await member();
    const [op, second, conflicted] = [await operator(), await operator(), await operator()];
    expect(await errors(await op.call('POST', '/staff/disclosures', request(user.userId, { notifyUser: false })))).toEqual([{ field: 'withheldReason', reason: 'required' }]);
    expect(await errors(await op.call('POST', '/staff/disclosures', request(user.userId, { withheldReason: 'Court order 77/2026 forbids notice.' }))))
      .toEqual([{ field: 'withheldReason', reason: 'only-when-not-notified' }]);
    expect((await op.call('POST', '/staff/disclosures', request(randomUUID()))).status).toBe(404);
    expect((await conflicted.call('POST', '/staff/conflicts', { userId: user.userId, reason: 'The user is my brother-in-law.' })).status).toBe(204);
    expect((await conflicted.call('POST', '/staff/disclosures', request(user.userId))).status).toBe(403);
    const { disclosureId, approvalId } = (await (await op.call('POST', '/staff/disclosures', request(user.userId, { notifyUser: false, withheldReason: 'Court order 77/2026 forbids notice.' }))).json()) as { disclosureId: string; approvalId: string };
    expect((await second.call('POST', `/staff/approvals/${approvalId}/decision`, { decision: 'approved' })).status).toBe(200);
    expect(await (await op.call('GET', `/staff/disclosures/${disclosureId}`)).json()).toMatchObject({ status: 'disclosed', userNotifiedAt: null, withheldReason: 'Court order 77/2026 forbids notice.' });
    expect(await fx.query(`SELECT 1 FROM disputes.outbox WHERE aggregate_id = $1`, [disclosureId])).toEqual([]);
    expect((await user.call('POST', '/staff/disclosures', request(user.userId))).status).toBe(401);
  });

  it('I-63 two years after a dispute closes, its statements\' text, evidence files and the seller\'s handover photos go; the dispute and its outcome stay', async () => {
    const [buyer, seller] = [await member(), await member()];
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Lamp for the privacy tests', 'A lamp in good condition, written by the privacy tests.', 'used', true,
          'pickup_only', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 200000, 1, 1) RETURNING id`, [seller.userId, category]);
    const [{ id: orderId }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at,
          fulfilment_done_at, delivery_event_at, delivery_event_source)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 200000, 200000, 'self_pickup', 0, 200000, '{"title":"Lamp"}', 500, 1000, 1, now(), 'paid', now(),
          'meetup_handover', now() + interval '3 days', now(), now(), 'handover_code') RETURNING id`, [listingId, buyer.userId, seller.userId]);
    await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', 200000, 'succeeded', now(), now())`, [orderId, buyer.userId]);
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected, dispute_window_ends_at, auto_release_at) VALUES ($1, 'standard', 200000, now() + interval '3 days', now() + interval '5 days')`, [orderId]);
    const { disputeId } = (await (await buyer.call('POST', `/orders/${orderId}/disputes`, { type: 'not_as_described', description: 'The lamp arrived with a cracked shade.' })).json()) as { disputeId: string };
    await buyer.call('POST', `/disputes/${disputeId}/statements`, { text: 'Photo of the crack attached.' });
    const png = await sharp({ create: { width: 200, height: 150, channels: 3, background: '#a77' } }).png().toBuffer();
    expect((await buyer.upload(`/disputes/${disputeId}/evidence`, png)).status).toBe(201);
    const before = (await (await buyer.call('GET', `/disputes/${disputeId}`)).json()) as { evidence: { link: { url: string } }[] };
    const link = before.evidence[0].link.url;
    expect((await buyer.open(link)).status).toBe(200);

    await fx.query(`INSERT INTO delivery.handover_photos (order_id, seller_id, storage_key, sha256) VALUES ($1, $2, 'dispute_evidence/handover-photo-test', decode(repeat('ab', 32), 'hex'))`, [orderId, seller.userId]);
    const privacy = t.app.get(PrivacyService);
    await privacy.purgeCaseFiles(); // two years: a live dispute is never purged, nor a recent one
    expect(await fx.query(`SELECT purged_at FROM disputes.disputes WHERE id = $1`, [disputeId])).toEqual([{ purged_at: null }]);
    await buyer.call('POST', `/disputes/${disputeId}/withdraw`);
    expect(await privacy.purgeCaseFiles('-1 second')).toBeGreaterThanOrEqual(1); // as if two years had passed
    expect(await fx.query(`SELECT text, purged_at IS NOT NULL AS purged FROM disputes.statements WHERE dispute_id = $1`, [disputeId])).toEqual([{ text: null, purged: true }]);
    expect(await fx.query(`SELECT storage_key, mime, purged_at IS NOT NULL AS purged FROM disputes.evidence WHERE dispute_id = $1`, [disputeId])).toEqual([{ storage_key: null, mime: 'image/jpeg', purged: true }]);
    expect((await buyer.open(link)).status).not.toBe(200); // the file itself is erased
    // U10-23: the seller's handover photos of the order go with the last of its disputes (the row stays, the key is emptied)
    expect(await fx.query(`SELECT storage_key, purged_at IS NOT NULL AS purged FROM delivery.handover_photos WHERE order_id = $1`, [orderId])).toEqual([{ storage_key: null, purged: true }]);
    expect(await fx.query(`SELECT status, purged_at IS NOT NULL AS purged, description FROM disputes.disputes WHERE id = $1`, [disputeId]))
      .toEqual([{ status: 'withdrawn', purged: true, description: 'The lamp arrived with a cracked shade.' }]);
    const view = (await (await buyer.call('GET', `/disputes/${disputeId}`)).json()) as { statements: { text: string | null }[]; evidence: { link: unknown }[] };
    expect(view.statements).toEqual([{ party: 'buyer', text: null, at: expect.any(String) }]);
    expect(view.evidence).toEqual([{ id: expect.any(String), mime: 'image/jpeg', size: expect.any(Number), at: expect.any(String), link: null }]); // listed, without a link
  });
});
