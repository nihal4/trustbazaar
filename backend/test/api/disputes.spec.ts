import { randomInt, randomUUID } from 'crypto';
import { DisputeService } from '../../src/modules/trust/services/dispute.service';
import { TrustDataExport } from '../../src/modules/trust/services/data-export';
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
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
      fetch(t.url(path), {
        method,
        headers: { ...headers, ...extra, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const upload = async (path: string, bytes: Buffer, type: string) => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(bytes)], { type }), 'evidence');
      return fetch(t.url(path), { method: 'POST', headers, body: form });
    };
    return { userId, call, upload };
  }
  /** A delivered order (by courier, or by a meetup code) with the escrow held; its chat thread exists. `windowEnds` in days (negative: ended). */
  async function deliveredOrder(windowEnds = 3, how: 'courier' | 'meetup' = 'courier') {
    const [buyer, seller] = [await member(), await member()];
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Walton fridge for the disputes', 'A fridge in good condition, written by the dispute tests.', 'used', true,
          'pickup_only', 'over_10kg', 'large', 'Dhaka', 23.81, 90.41, 2500000, 1, 1) RETURNING id`,
      [seller.userId, category],
    );
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at,
          fulfilment_done_at, delivery_event_at, delivery_event_source, delivery_quote_id)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 2500000, 2500000, $4, 0, 2500000, '{"title":"Walton fridge"}', 500, 1000, 1, now(), 'paid', now(),
          $5, now() + interval '3 days', now(), now(), $6, $7) RETURNING id`,
      [
        listingId,
        buyer.userId,
        seller.userId,
        how === 'meetup' ? 'self_pickup' : 'courier',
        how === 'meetup' ? 'meetup_handover' : 'courier_pickup',
        how === 'meetup' ? 'handover_code' : 'courier_delivered',
        how === 'meetup' ? null : randomUUID(),
      ],
    );
    await fx.query(
      `INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', 2500000, 'succeeded', now(), now())`,
      [id, buyer.userId],
    );
    await fx.query(
      `INSERT INTO orders.escrows (order_id, release_policy, amount_collected, dispute_window_ends_at, auto_release_at) VALUES ($1, 'standard', 2500000, now() + $2::interval, now() + $2::interval + interval '2 days')`,
      [id, `${windowEnds} days`],
    );
    const [{ id: thread }] = await fx.query<{ id: string }>(`INSERT INTO chat.threads (listing_id, buyer_id, seller_id) VALUES ($1, $2, $3) RETURNING id`, [
      listingId,
      buyer.userId,
      seller.userId,
    ]);
    return { id, buyer, seller, thread };
  }
  const describeIt = 'The door seal is torn and the fridge does not cool at all.';
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;
  const escrow = async (orderId: string) =>
    (await fx.query<{ state: string; open_dispute_id: string | null }>(`SELECT state, open_dispute_id FROM orders.escrows WHERE order_id = $1`, [orderId]))[0];
  const holds = (thread: string) =>
    fx.query<{ case_id: string; live: boolean }>(
      `SELECT case_id, released_at IS NULL AS live FROM chat.thread_holds WHERE thread_id = $1 AND case_type = 'dispute'`,
      [thread],
    );
  const notices = (userId: string) =>
    fx.query<{ template_code: string; params: Record<string, unknown> }>(
      `SELECT template_code, params FROM notify.notifications WHERE user_id = $1 AND template_code LIKE 'dispute.%' ORDER BY created_at`,
      [userId],
    );

  it('FR-DSP-01 FR-DSP-02 FR-DSP-03 I-56 the buyer opens a dispute in its window: the escrow freezes, the chat is held, both are told', async () => {
    const o = await deliveredOrder();
    expect(await (await o.buyer.call('GET', `/orders/${o.id}/dispute-types`)).json()).toEqual({
      types: ['not_as_described', 'damaged', 'other'],
      openDisputeId: null,
    }); // not_received: no courier pickup
    expect((await o.seller.call('GET', `/orders/${o.id}/dispute-types`)).status).toBe(404);
    expect(await errors(await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'credentials_invalid', description: describeIt }))).toEqual([
      { field: 'type', reason: 'not-for-this-item' },
    ]);
    expect((await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: 'Broken.' })).status).toBe(400);
    expect((await o.seller.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).status).toBe(404); // the buyer opens
    const r = await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt });
    expect(r.status).toBe(201);
    const { disputeId } = (await r.json()) as { disputeId: string };
    expect(await escrow(o.id)).toEqual({ state: 'frozen_disputed', open_dispute_id: disputeId });
    expect(await holds(o.thread)).toEqual([{ case_id: disputeId, live: true }]);
    expect(await notices(o.seller.userId)).toEqual([{ template_code: 'dispute.opened_seller', params: { listing_title: 'Walton fridge', hours: 48 } }]);
    expect(await notices(o.buyer.userId)).toEqual([{ template_code: 'dispute.opened_buyer', params: { listing_title: 'Walton fridge' } }]);
    expect(await errors(await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'other', description: describeIt }))).toEqual([
      { field: 'order', reason: 'dispute-open' },
    ]);
    expect(await (await o.buyer.call('GET', `/orders/${o.id}/dispute-types`)).json()).toEqual({ types: [], openDisputeId: disputeId });
    expect(await fx.query(`SELECT to_status, actor, reason FROM disputes.history WHERE dispute_id = $1`, [disputeId])).toEqual([
      { to_status: 'open', actor: 'buyer', reason: 'opened' },
    ]);
  });

  it('FR-DSP-11 outside the window, or before payment, no dispute opens and nothing freezes', async () => {
    const late = await deliveredOrder(-1);
    expect(await (await late.buyer.call('GET', `/orders/${late.id}/dispute-types`)).json()).toEqual({ types: [], openDisputeId: null });
    expect(await errors(await late.buyer.call('POST', `/orders/${late.id}/disputes`, { type: 'damaged', description: describeIt }))).toEqual([
      { field: 'type', reason: 'dispute-not-allowed' },
    ]);
    expect(await escrow(late.id)).toEqual({ state: 'held', open_dispute_id: null });
    expect(await fx.query(`SELECT count(*)::int AS n FROM disputes.disputes WHERE order_id = $1`, [late.id])).toEqual([{ n: 0 }]);
  });

  it("FR-DSP-04 FR-DSP-09 the seller's first statement is the response and starts the review; both parties add statements", async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'not_as_described', description: describeIt })).json()) as {
      disputeId: string;
    };
    expect(await (await o.buyer.call('POST', `/disputes/${disputeId}/statements`, { text: 'Photos attached of the seal.' })).json()).toEqual({
      status: 'open',
    });
    expect(await (await o.seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'It worked when we met; the buyer tested it.' })).json()).toEqual({
      status: 'under_review',
    });
    expect(await (await o.seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'Here is the video from the handover.' })).json()).toEqual({
      status: 'under_review',
    });
    expect((await (await member()).call('POST', `/disputes/${disputeId}/statements`, { text: 'Me too.' })).status).toBe(404);
    const view = (await (await o.seller.call('GET', `/disputes/${disputeId}`)).json()) as {
      role: string;
      status: string;
      reviewStartedAt: string;
      decisionTargetAt: string;
      statements: { party: string }[];
    };
    expect(view).toMatchObject({ role: 'seller', status: 'under_review' });
    expect(new Date(view.decisionTargetAt).getTime() - new Date(view.reviewStartedAt).getTime()).toBe(5 * 86_400_000); // CP-21
    // the parties never see each other's words (U10-23): the seller sees only its own statements, and not the buyer's description
    expect(view.statements.map((s) => s.party)).toEqual(['seller', 'seller']);
    expect((view as unknown as { description: string | null }).description).toBeNull();
    const buyerView = (await (await o.buyer.call('GET', `/disputes/${disputeId}`)).json()) as {
      description: string;
      statements: { party: string; text: string }[];
    };
    expect(buyerView.statements.map((s) => s.party)).toEqual(['buyer']);
    expect(buyerView.description).toBe(describeIt);
    expect((await (await member()).call('GET', `/disputes/${disputeId}`)).status).toBe(404);
  });

  it("FR-DSP-04 U10-23 each party has a chat with TrustBazaar: its own statements and what TrustBazaar sent it, never the other party's words", async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'not_as_described', description: describeIt })).json()) as {
      disputeId: string;
    };
    await o.buyer.call('POST', `/disputes/${disputeId}/statements`, { text: 'The buyer wrote this.' });
    await o.seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'The seller wrote this.' });
    type Chat = { role: string; items: { from: string; text?: string | null; template?: string; params?: Record<string, unknown> }[] };
    const seller = (await (await o.seller.call('GET', `/disputes/${disputeId}/chat`)).json()) as Chat;
    const buyer = (await (await o.buyer.call('GET', `/disputes/${disputeId}/chat`)).json()) as Chat;
    expect(seller.items.filter((i) => i.from === 'you').map((i) => i.text)).toEqual(['The seller wrote this.']);
    expect(buyer.items.filter((i) => i.from === 'you').map((i) => i.text)).toEqual(['The buyer wrote this.']);
    expect(seller.items.filter((i) => i.from === 'trustbazaar').map((i) => i.template)).toEqual(['dispute.opened_seller']); // the complaint, from TrustBazaar
    expect(buyer.items.filter((i) => i.from === 'trustbazaar').map((i) => i.template)).toEqual(['dispute.opened_buyer']);
    expect(JSON.stringify(seller)).not.toContain('The buyer wrote this.');
    expect(JSON.stringify(buyer)).not.toContain('The seller wrote this.');
    expect((await (await member()).call('GET', `/disputes/${disputeId}/chat`)).status).toBe(404);
    // the unseen messages of TrustBazaar are counted on the order's list until the party has read its chat
    type List = { items: { unseen: number }[] };
    expect(((await (await o.seller.call('GET', `/orders/${o.id}/disputes`)).json()) as List).items[0].unseen).toBe(1);
    expect((await o.seller.call('POST', `/disputes/${disputeId}/chat/seen`)).status).toBe(200);
    expect(((await (await o.seller.call('GET', `/orders/${o.id}/disputes`)).json()) as List).items[0].unseen).toBe(0);
    expect(((await (await o.buyer.call('GET', `/orders/${o.id}/disputes`)).json()) as List).items[0].unseen).toBe(1); // the buyer's own count is its own
    expect((await (await member()).call('POST', `/disputes/${disputeId}/chat/seen`)).status).toBe(404);
  });

  it('FR-DSP-04 CP-20 without a response in 48 hours the job starts the review on the evidence available', async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as {
      disputeId: string;
    };
    const job = t.app.get(DisputeService);
    await job.startOverdueReviews();
    expect((await fx.query<{ status: string }>(`SELECT status FROM disputes.disputes WHERE id = $1`, [disputeId]))[0].status).toBe('open');
    await fx.query(`UPDATE disputes.disputes SET seller_due_at = now() - interval '1 minute' WHERE id = $1`, [disputeId]);
    expect(await job.startOverdueReviews()).toBeGreaterThanOrEqual(1);
    expect(await fx.query(`SELECT to_status, actor, reason FROM disputes.history WHERE dispute_id = $1 ORDER BY id`, [disputeId])).toEqual([
      { to_status: 'open', actor: 'buyer', reason: 'opened' },
      { to_status: 'under_review', actor: 'system', reason: 'response window ended' },
    ]);
    // a late response is kept as a statement
    expect(await (await o.seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'Sorry, I was travelling.' })).json()).toEqual({
      status: 'under_review',
    });
  });

  it('CP-33 each party adds evidence images, kept encrypted, at most 10 per dispute; other files are refused', async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as {
      disputeId: string;
    };
    const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#7a7' } })
      .png()
      .toBuffer();
    const up = await o.buyer.upload(`/disputes/${disputeId}/evidence`, png, 'image/png');
    expect(up.status).toBe(201);
    expect((await o.buyer.upload(`/disputes/${disputeId}/evidence`, Buffer.from('%PDF-1.4 a receipt'), 'application/pdf')).status).toBe(400);
    expect((await (await member()).upload(`/disputes/${disputeId}/evidence`, png, 'image/png')).status).toBe(404);
    const view = (await (await o.buyer.call('GET', `/disputes/${disputeId}`)).json()) as { evidence: { mime: string; link: { url: string } }[] };
    expect(view.evidence).toHaveLength(1);
    expect(view.evidence[0].link.url).toMatch(/^\/api\/v1\/files\/v\//);
    expect(((await (await o.seller.call('GET', `/disputes/${disputeId}`)).json()) as { evidence: unknown[] }).evidence).toEqual([]); // own evidence only
    for (let i = 0; i < 9; i++) {
      await fx.query(
        `INSERT INTO disputes.evidence (dispute_id, party, storage_key, sha256, mime, byte_size) VALUES ($1, 'seller', $2, decode(repeat('ab', 32), 'hex'), 'image/jpeg', 100)`,
        [disputeId, `test-${randomUUID()}`],
      );
    }
    expect(await errors(await o.seller.upload(`/disputes/${disputeId}/evidence`, png, 'image/png'))).toEqual([{ field: 'file', reason: 'evidence-limit' }]);
  });

  it('FR-DSP-10 the buyer withdraws before the decision: the escrow is held again, the chat released, that type cannot be reopened', async () => {
    const o = await deliveredOrder();
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as {
      disputeId: string;
    };
    expect((await o.seller.call('POST', `/disputes/${disputeId}/withdraw`)).status).toBe(404);
    expect(await (await o.buyer.call('POST', `/disputes/${disputeId}/withdraw`)).json()).toEqual({ status: 'withdrawn' });
    expect(await escrow(o.id)).toEqual({ state: 'held', open_dispute_id: null });
    expect(await holds(o.thread)).toEqual([{ case_id: disputeId, live: false }]);
    expect((await notices(o.seller.userId)).map((n) => n.template_code)).toEqual(['dispute.opened_seller', 'dispute.withdrawn_seller']);
    expect(await errors(await o.buyer.call('POST', `/disputes/${disputeId}/withdraw`))).toEqual([{ field: 'dispute', reason: 'closed' }]);
    expect(await errors(await o.buyer.call('POST', `/disputes/${disputeId}/statements`, { text: 'One more thing.' }))).toEqual([
      { field: 'dispute', reason: 'closed' },
    ]);
    expect(await errors(await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt }))).toEqual([
      { field: 'type', reason: 'type-withdrawn' },
    ]);
    expect(await (await o.buyer.call('GET', `/orders/${o.id}/dispute-types`)).json()).toEqual({ types: ['not_as_described', 'other'], openDisputeId: null });
    expect((await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'other', description: describeIt })).status).toBe(201);
  });

  it("FR-DSP-07 SEC-SDL-09 either party finds the order's disputes, newest first, also after a withdrawal; no one else does", async () => {
    const o = await deliveredOrder();
    expect(await (await o.seller.call('GET', `/orders/${o.id}/disputes`)).json()).toEqual({ items: [] });
    const { disputeId: first } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as {
      disputeId: string;
    };
    await o.buyer.call('POST', `/disputes/${first}/withdraw`);
    const { disputeId: second } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'other', description: describeIt })).json()) as {
      disputeId: string;
    };
    const seen = (await (await o.seller.call('GET', `/orders/${o.id}/disputes`)).json()) as {
      items: { id: string; type: string; status: string; withdrawnAt: string | null }[];
    };
    expect(seen.items.map((d) => [d.id, d.type, d.status, d.withdrawnAt !== null])).toEqual([
      [second, 'other', 'open', false],
      [first, 'damaged', 'withdrawn', true],
    ]);
    const strip = (l: { items: object[] }) => l.items.map((i) => ({ ...i, unseen: undefined })); // the count of unseen messages is each party's own
    expect(strip((await (await o.buyer.call('GET', `/orders/${o.id}/disputes`)).json()) as { items: object[] })).toEqual(strip(seen));
    expect((await (await member()).call('GET', `/orders/${o.id}/disputes`)).status).toBe(404);
  });
  it('FR-DSP-01 U10-23 after a meetup code is entered only not_as_described can be opened; by courier every physical type stays open', async () => {
    const m = await deliveredOrder(3, 'meetup');
    expect(await (await m.buyer.call('GET', `/orders/${m.id}/dispute-types`)).json()).toEqual({ types: ['not_as_described'], openDisputeId: null });
    expect(await errors(await m.buyer.call('POST', `/orders/${m.id}/disputes`, { type: 'damaged', description: describeIt }))).toEqual([
      { field: 'type', reason: 'closed-after-meetup' },
    ]);
    expect(
      (
        await m.buyer.call('POST', `/orders/${m.id}/disputes`, {
          type: 'not_as_described',
          description: 'The listing says battery health 91%, the service centre report shows 78% and a non-genuine battery.',
        })
      ).status,
    ).toBe(201);
    const c = await deliveredOrder(3, 'courier');
    expect(await (await c.buyer.call('GET', `/orders/${c.id}/dispute-types`)).json()).toEqual({
      types: ['not_as_described', 'damaged', 'other'],
      openDisputeId: null,
    });
  });
  it('CP-33 a party adds up to two videos as evidence, kept encrypted and served as video; a file that is not a video, or a third video, is refused', async () => {
    const o = await deliveredOrder(3, 'courier');
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as {
      disputeId: string;
    };
    const mp4 = (n: number) => {
      const b = Buffer.alloc(2048 + n, 1);
      b.write('ftypisom', 4, 'ascii');
      return b;
    };
    expect((await o.buyer.upload(`/disputes/${disputeId}/evidence`, mp4(1), 'video/mp4')).status).toBe(201);
    expect((await o.buyer.upload(`/disputes/${disputeId}/evidence`, mp4(2), 'video/quicktime')).status).toBe(201);
    expect(await errors(await o.buyer.upload(`/disputes/${disputeId}/evidence`, mp4(3), 'video/mp4'))).toEqual([{ field: 'file', reason: 'too_many_videos' }]);
    expect(await errors(await o.seller.upload(`/disputes/${disputeId}/evidence`, Buffer.alloc(4096, 7), 'video/mp4'))).toEqual([
      { field: 'file', reason: 'unreadable' },
    ]);
    const rows = await fx.query<{ mime: string }>(`SELECT mime FROM disputes.evidence WHERE dispute_id = $1 ORDER BY at`, [disputeId]);
    expect(rows.map((r) => r.mime)).toEqual(['video/mp4', 'video/mp4']); // two a party
  });
  it("FR-DSP-01 U10-23 the buyer's acceptance of the terms is kept with its version; the seller and strangers cannot record one; it cannot be changed", async () => {
    const o = await deliveredOrder(3, 'meetup');
    const accepted = await o.buyer.call('POST', `/orders/${o.id}/terms-acceptances`, { kind: 'dispute', version: 1 });
    expect(accepted.status).toBe(201);
    expect(await o.seller.call('POST', `/orders/${o.id}/terms-acceptances`, { kind: 'dispute', version: 1 }).then((r) => r.status)).toBe(404);
    expect((await o.buyer.call('POST', `/orders/${o.id}/terms-acceptances`, { kind: 'whatever', version: 1 })).status).toBe(400);
    const rows = await fx.query<{ kind: string; terms_version: number; user_id: string }>(
      `SELECT kind, terms_version, user_id FROM orders.terms_acceptances WHERE order_id = $1`,
      [o.id],
    );
    expect(rows).toEqual([{ kind: 'dispute', terms_version: 1, user_id: o.buyer.userId }]);
    await expect(fx.query(`UPDATE orders.terms_acceptances SET terms_version = 2 WHERE order_id = $1`, [o.id])).rejects.toThrow();
  });

  it('FR-DSP-01 U10-23 the terms proof: only the current version, only a step the order is at, and the first acceptance stays', async () => {
    const o = await deliveredOrder(3, 'meetup');
    const accept = (kind: string, version: number) => o.buyer.call('POST', `/orders/${o.id}/terms-acceptances`, { kind, version });
    expect(await errors(await accept('dispute', 2))).toEqual([{ field: 'version', reason: 'outdated' }]);
    expect(await errors(await accept('courier', 1))).toEqual([{ field: 'kind', reason: 'not-now' }]); // a meetup order has no courier step
    const first = (await (await accept('dispute', 1)).json()) as { acceptedAt: string };
    const again = (await (await accept('dispute', 1)).json()) as { acceptedAt: string };
    expect(again.acceptedAt).toBe(first.acceptedAt);
    expect((await fx.query(`SELECT 1 FROM orders.terms_acceptances WHERE order_id = $1`, [o.id])).length).toBe(1);
  });

  it("FR-DSP-04 U10-23 the seller's data export does not carry the buyer's description; a picture that only looks like a video is refused; a video plays in ranges", async () => {
    const o = await deliveredOrder(3, 'courier');
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as {
      disputeId: string;
    };
    const exported = (await t.app.get(TrustDataExport).exportFor(o.seller.userId)) as { disputes: { description?: string }[] };
    expect(exported.disputes.map((d) => d.description)).toEqual([undefined]);
    const buyerExport = (await t.app.get(TrustDataExport).exportFor(o.buyer.userId)) as { disputes: { description?: string }[] };
    expect(buyerExport.disputes.map((d) => d.description)).toEqual([describeIt]);
    const heic = Buffer.alloc(4096, 1);
    heic.write('ftypheic', 4, 'ascii');
    expect(await errors(await o.buyer.upload(`/disputes/${disputeId}/evidence`, heic, 'video/mp4'))).toEqual([{ field: 'file', reason: 'unreadable' }]);
    const mp4 = Buffer.alloc(5000, 2);
    mp4.write('ftypisom', 4, 'ascii');
    expect((await o.buyer.upload(`/disputes/${disputeId}/evidence`, mp4, 'video/mp4')).status).toBe(201);
    const chat = (await (await o.buyer.call('GET', `/disputes/${disputeId}/chat`)).json()) as { items: { file?: { link: { url: string } } }[] };
    const url = chat.items.find((i) => i.file)!.file!.link.url;
    const part = await o.buyer.call('GET', url.replace(/^https?:\/\/[^/]+/, ''), undefined, { range: 'bytes=0-99' });
    expect([part.status, part.headers.get('content-range'), part.headers.get('content-disposition'), (await part.arrayBuffer()).byteLength]).toEqual([
      206,
      'bytes 0-99/5000',
      'inline',
      100,
    ]);
  });
  it('SEC-ABU-01 U10-23 a file sent to a dispute is rate limited per user: after 30 an hour the route answers 429, whatever the file', async () => {
    const o = await deliveredOrder(3, 'courier');
    const { disputeId } = (await (await o.buyer.call('POST', `/orders/${o.id}/disputes`, { type: 'damaged', description: describeIt })).json()) as {
      disputeId: string;
    };
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await o.buyer.upload(`/disputes/${disputeId}/evidence`, Buffer.from('%PDF-1.4'), 'application/pdf')).status);
    expect([statuses[0], statuses[29], statuses[30]]).toEqual([400, 400, 429]);
  });
});
