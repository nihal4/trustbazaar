import { randomInt, randomUUID } from 'crypto';
import { DisputeService } from '../../src/modules/trust/services/dispute.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U7-03, first part: disputes on physical goods from the parties' side (docs/design/07_disputes_trust_staff.pdf sections
// 5.1 to 5.3 and 5.7; FR-DSP-01 to FR-DSP-04, FR-DSP-09 to FR-DSP-11, I-56) against PostgreSQL through the real security
// pipeline. Orders are written directly as paid and delivered by handover, with the escrow held and the CP-18 window set.
describe('disputes: opening, statements, evidence, withdrawal', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`,
      [`disputes-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const headers = { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip };
    const call = (method: string, path: string, body?: unknown) => fetch(t.url(path), {
      method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const upload = async (path: string, bytes: Buffer, type: string) => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(bytes)], { type }), 'evidence');
      return fetch(t.url(path), { method: 'POST', headers, body: form });
    };
    return { userId, call, upload };
  }
  /** A delivered self-pickup order with the escrow held; its chat thread exists. `windowEnds` in days (negative: ended). */
  async function deliveredOrder(windowEnds = 3) {
    const [buyer, seller] = [await member(), await member()];
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Walton fridge for the disputes', 'A fridge in good condition, written by the dispute tests.', 'used', true,
          'pickup_only', 'over_10kg', 'large', 'Dhaka', 23.81, 90.41, 2500000, 1, 1) RETURNING id`, [seller.userId, category]);
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at,
          fulfilment_done_at, delivery_event_at, delivery_event_source)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 2500000, 2500000, 'self_pickup', 0, 2500000, '{"title":"Walton fridge"}', 500, 1000, 1, now(), 'paid', now(),
          'meetup_handover', now() + interval '3 days', now(), now(), 'handover_code') RETURNING id`, [listingId, buyer.userId, seller.userId]);
    await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', 2500000, 'succeeded', now(), now())`, [id, buyer.userId]);
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected, dispute_window_ends_at, auto_release_at) VALUES ($1, 'standard', 2500000, now() + $2::interval, now() + $2::interval + interval '2 days')`,
      [id, `${windowEnds} days`]);
    const [{ id: thread }] = await fx.query<{ id: string }>(`INSERT INTO chat.threads (listing_id, buyer_id, seller_id) VALUES ($1, $2, $3) RETURNING id`, [listingId, buyer.userId, seller.userId]);
    return { id, buyer, seller, thread };
  }
  const describeIt = 'The door seal is torn and the fridge does not cool at all.';
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;
  const escrow = async (orderId: string) => (await fx.query<{ state: string; open_dispute_id: string | null }>(`SELECT state, open_dispute_id FROM orders.escrows WHERE order_id = $1`, [orderId]))[0];
  const holds = (thread: string) => fx.query<{ case_id: string; live: boolean }>(`SELECT case_id, released_at IS NULL AS live FROM chat.thread_holds WHERE thread_id = $1 AND case_type = 'dispute'`, [thread]);
  const notices = (userId: string) => fx.query<{ template_code: string; params: Record<string, unknown> }>(`SELECT template_code, params FROM notify.notifications WHERE user_id = $1 AND template_code LIKE 'dispute.%' ORDER BY created_at`, [userId]);

  it('FR-DSP-01 FR-DSP-02 FR-DSP-03 I-56 the buyer opens a dispute in its window: the escrow freezes, the chat is held, both are told', async () => {
    const o = await deliveredOrder();
    expect(await (await o.buyer.call('GET', `/orders/${o.id}/dispute-types`)).json()).toEqual({ types: ['not_as_described', 'damaged', 'other'], openDisputeId: null }); // not_received: no courier pickup
    expect((await o.seller.call('GET', `/orders/${o.id}/dispute-types`)).status).toBe(404);
    expect(await errors(await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'credentials_invalid', description: describeIt }))).toEqual([{ field: 'type', reason: 'not-for-this-item' }]);
    expect((await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: 'Broken.' })).status).toBe(400);
    expect((await o.seller.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).status).toBe(404); // the buyer opens
    const r = await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt });
    expect(r.status).toBe(201);
    const { disputeId } = (await r.json()) as { disputeId: string };
    expect(await escrow(o.id)).toEqual({ state: 'frozen_disputed', open_dispute_id: disputeId });
    expect(await holds(o.thread)).toEqual([{ case_id: disputeId, live: true }]);
    expect(await notices(o.seller.userId)).toEqual([{ template_code: 'dispute.opened_seller', params: { listing_title: 'Walton fridge', hours: 48 } }]);
    expect(await notices(o.buyer.userId)).toEqual([{ template_code: 'dispute.opened_buyer', params: { listing_title: 'Walton fridge' } }]);
    expect(await errors(await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'other', description: describeIt }))).toEqual([{ field: 'order', reason: 'dispute-open' }]);
    expect(await (await o.buyer.call('GET', `/orders/${o.id}/dispute-types`)).json()).toEqual({ types: [], openDisputeId: disputeId });
    expect(await fx.query(`SELECT to_status, actor, reason FROM disputes.history WHERE dispute_id = $1`, [disputeId])).toEqual([{ to_status: 'open', actor: 'buyer', reason: 'opened' }]);
  });

  it('FR-DSP-11 outside the window, or before payment, no dispute opens and nothing freezes', async () => {
    const late = await deliveredOrder(-1);
    expect(await (await late.buyer.call('GET', `/orders/${late.id}/dispute-types`)).json()).toEqual({ types: [], openDisputeId: null });
    expect(await errors(await late.buyer.call('POST', `/orders/${late.id}/disputes`, { type: 'damaged', description: describeIt }))).toEqual([{ field: 'type', reason: 'dispute-not-allowed' }]);
    expect(await escrow(late.id)).toEqual({ state: 'held', open_dispute_id: null });
    expect(await fx.query(`SELECT count(*)::int AS n FROM disputes.disputes WHERE order_id = $1`, [late.id])).toEqual([{ n: 0 }]);
  });

  it('FR-DSP-04 FR-DSP-09 the seller\'s first statement is the response and starts the review; both parties add statements', async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'not_as_described', description: describeIt })).json()) as { disputeId: string };
    expect(await (await o.buyer.call('POST', `/disputes/${disputeId}/statements`, { text: 'Photos attached of the seal.' })).json()).toEqual({ status: 'open' });
    expect(await (await o.seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'It worked when we met; the buyer tested it.' })).json()).toEqual({ status: 'under_review' });
    expect(await (await o.seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'Here is the video from the handover.' })).json()).toEqual({ status: 'under_review' });
    expect((await (await member()).call('POST', `/disputes/${disputeId}/statements`, { text: 'Me too.' })).status).toBe(404);
    const view = (await (await o.seller.call('GET', `/disputes/${disputeId}`)).json()) as { role: string; status: string; reviewStartedAt: string; decisionTargetAt: string; statements: { party: string }[] };
    expect(view).toMatchObject({ role: 'seller', status: 'under_review' });
    expect(new Date(view.decisionTargetAt).getTime() - new Date(view.reviewStartedAt).getTime()).toBe(5 * 86_400_000); // CP-21
    expect(view.statements.map((s) => s.party)).toEqual(['buyer', 'seller', 'seller']);
    expect((await (await member()).call('GET', `/disputes/${disputeId}`)).status).toBe(404);
  });

  it('FR-DSP-04 CP-20 without a response in 48 hours the job starts the review on the evidence available', async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as { disputeId: string };
    const job = t.app.get(DisputeService);
    await job.startOverdueReviews();
    expect((await fx.query<{ status: string }>(`SELECT status FROM disputes.disputes WHERE id = $1`, [disputeId]))[0].status).toBe('open');
    await fx.query(`UPDATE disputes.disputes SET seller_due_at = now() - interval '1 minute' WHERE id = $1`, [disputeId]);
    expect(await job.startOverdueReviews()).toBeGreaterThanOrEqual(1);
    expect(await fx.query(`SELECT to_status, actor, reason FROM disputes.history WHERE dispute_id = $1 ORDER BY id`, [disputeId]))
      .toEqual([{ to_status: 'open', actor: 'buyer', reason: 'opened' }, { to_status: 'under_review', actor: 'system', reason: 'response window ended' }]);
    // a late response is kept as a statement
    expect(await (await o.seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'Sorry, I was travelling.' })).json()).toEqual({ status: 'under_review' });
  });

  it('CP-33 each party adds evidence images, kept encrypted, at most 10 per dispute; other files are refused', async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as { disputeId: string };
    const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#7a7' } }).png().toBuffer();
    const up = await o.buyer.upload(`/disputes/${disputeId}/evidence`, png, 'image/png');
    expect(up.status).toBe(201);
    expect((await o.buyer.upload(`/disputes/${disputeId}/evidence`, Buffer.from('%PDF-1.4 a receipt'), 'application/pdf')).status).toBe(400);
    expect((await (await member()).upload(`/disputes/${disputeId}/evidence`, png, 'image/png')).status).toBe(404);
    const view = (await (await o.buyer.call('GET', `/disputes/${disputeId}`)).json()) as { evidence: { mime: string; link: { url: string } }[] };
    expect(view.evidence).toHaveLength(1);
    expect(view.evidence[0].link.url).toMatch(/^\/api\/v1\/files\/v\//);
    expect(((await (await o.seller.call('GET', `/disputes/${disputeId}`)).json()) as { evidence: unknown[] }).evidence).toEqual([]); // own evidence only
    for (let i = 0; i < 9; i++) {
      await fx.query(`INSERT INTO disputes.evidence (dispute_id, party, storage_key, sha256, mime, byte_size) VALUES ($1, 'seller', $2, decode(repeat('ab', 32), 'hex'), 'image/jpeg', 100)`, [disputeId, `test-${randomUUID()}`]);
    }
    expect(await errors(await o.seller.upload(`/disputes/${disputeId}/evidence`, png, 'image/png'))).toEqual([{ field: 'file', reason: 'evidence-limit' }]);
  });

  it('FR-DSP-10 the buyer withdraws before the decision: the escrow is held again, the chat released, that type cannot be reopened', async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as { disputeId: string };
    expect((await o.seller.call('POST', `/disputes/${disputeId}/withdraw`)).status).toBe(404);
    expect(await (await o.buyer.call('POST', `/disputes/${disputeId}/withdraw`)).json()).toEqual({ status: 'withdrawn' });
    expect(await escrow(o.id)).toEqual({ state: 'held', open_dispute_id: null });
    expect(await holds(o.thread)).toEqual([{ case_id: disputeId, live: false }]);
    expect((await notices(o.seller.userId)).map((n) => n.template_code)).toEqual(['dispute.opened_seller', 'dispute.withdrawn_seller']);
    expect(await errors(await o.buyer.call('POST', `/disputes/${disputeId}/withdraw`))).toEqual([{ field: 'dispute', reason: 'closed' }]);
    expect(await errors(await o.buyer.call('POST', `/disputes/${disputeId}/statements`, { text: 'One more thing.' }))).toEqual([{ field: 'dispute', reason: 'closed' }]);
    expect(await errors(await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt }))).toEqual([{ field: 'type', reason: 'type-withdrawn' }]);
    expect(await (await o.buyer.call('GET', `/orders/${o.id}/dispute-types`)).json()).toEqual({ types: ['not_as_described', 'other'], openDisputeId: null });
    expect((await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'other', description: describeIt })).status).toBe(201);
  });
});
