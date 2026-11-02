import { randomInt, randomUUID } from 'crypto';
import { OutboxDispatcher } from '../../src/kernel/events/outbox-dispatcher';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U4-03: the meetup handover against PostgreSQL and Redis (docs/design/04_delivery.pdf sections 3.1 and 6): the
// handover from orders.order.paid, suggested public points, proposals, the buyer's code, the seller's entry recorded
// in Unit 2's escrow in one transaction (DC-14), the CP-45 lock, the operator's unlock, and cancellation on refund.
// Paid orders are written as the escrow tests write them; Unit 2's events are delivered by draining the outbox.

describe('meetup handover', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let dispatcher: OutboxDispatcher;
  let points: string[] = [];
  // a spot in Sylhet division chosen per run, so earlier runs' points (deactivated after each run) cannot interfere
  const BASE = { lat: 24.3 + randomInt(0, 600) / 1000, lng: 91.3 + randomInt(0, 600) / 1000 };

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER = 'off';
    t = await startApp();
    fx = await IdentityFixtures.open();
    dispatcher = t.app.get(OutboxDispatcher);
    const adm = await admin();
    const add = async (nameEn: string, lat: number, lng: number, kind = 'police_station') => {
      const r = await adm.call('POST', '/admin/meetup-points', { kind, nameEn, nameBn: 'থানা', district: 'Sylhet', lat, lng, guidance: 'Main gate' });
      expect(r.status).toBe(201);
      return ((await r.json()) as { id: string }).id;
    };
    points = [
      await add('Test point A', BASE.lat + 0.001, BASE.lng + 0.001),
      await add('Test point B', BASE.lat + 0.004, BASE.lng + 0.002, 'shopping_mall'),
      await add('Test point C', BASE.lat - 0.005, BASE.lng - 0.003, 'bank_branch'),
      await add('Test point D', BASE.lat + 0.03, BASE.lng + 0.03),
    ];
  });
  afterAll(async () => {
    delete process.env.OUTBOX_DISPATCHER;
    if (points.length) await fx?.query(`UPDATE delivery.meetup_points SET active = false WHERE id = ANY($1::uuid[])`, [points]);
    await fx?.close();
    await t?.close();
  });

  async function admin(role: 'administrator' | 'operator' = 'administrator') {
    const staffId = await fx.staff(role);
    const sid = await fx.session({ staffId });
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), { method, headers: { ...fx.headers(sid, staffId, 'staff'), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { staffId, call };
  }
  async function member(at?: { lat: number; lng: number }) {
    const userId = await fx.user();
    if (at) await fx.query(`UPDATE identity.users SET area_district = 'Sylhet', approx_lat = $2, approx_lng = $3 WHERE id = $1`, [userId, at.lat, at.lng]);
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), { method, headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, status = 200) => {
      const r = await call(method, path, body);
      expect({ path, status: r.status }).toEqual({ path, status });
      return (await r.json()) as T;
    };
    return { userId, call, json };
  }
  type View = {
    status: string; role: string; dueAt: string; code: string | null; attemptsLeft: number | null;
    suggestions: { id: string; nameEn: string; mapUrl: string }[]; proposals: { id: string; status: string; byMe: boolean }[]; agreed: { meetAt: string } | null;
  };

  /** A self-pickup order paid as a confirmed payment leaves it, with Unit 2's orders.order.paid delivered. */
  async function paidOrder(o: { fulfilment?: 'self_pickup' | 'courier'; dueIn?: string } = {}) {
    const buyer = await member({ lat: BASE.lat + 0.006, lng: BASE.lng - 0.004 });
    const seller = await member({ lat: BASE.lat - 0.004, lng: BASE.lng + 0.006 });
    const fulfilment = o.fulfilment ?? 'self_pickup';
    const [{ id, due }] = await fx.query<{ id: string; due: Date }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_quote_id, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 1000000, 1000000, $4, $5, $6, $7, '{"title":"Item"}', 500, 1000, 1, now(), 'paid', now(), $8, now() + $9::interval)
       RETURNING id, fulfilment_due_at AS due`,
      [randomUUID(), buyer.userId, seller.userId, fulfilment, fulfilment === 'courier' ? randomUUID() : null, fulfilment === 'courier' ? 15000 : 0,
       fulfilment === 'courier' ? 1015000 : 1000000, fulfilment === 'courier' ? 'courier_pickup' : 'meetup_handover', o.dueIn ?? '7 days'],
    );
    await fx.query(`INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, status, expires_at, confirmed_at) VALUES ('order', $1, $2, 'bkash', 1000000, 'succeeded', now(), now())`, [id, buyer.userId]);
    await fx.query(`INSERT INTO orders.escrows (order_id, release_policy, amount_collected) VALUES ($1, 'standard', 1000000)`, [id]);
    await paidEvent(id, buyer.userId, seller.userId, fulfilment, due);
    return { id, buyer, seller };
  }
  async function paidEvent(id: string, buyer: string, seller: string, fulfilment: string, due: Date) {
    await fx.query(`INSERT INTO orders.outbox (event_type, aggregate_id, payload) VALUES ('orders.order.paid', $1, $2)`, [id, JSON.stringify({
      orderId: id, kind: 'fixed_price', itemKind: 'physical', buyerId: buyer, sellerId: seller, fulfilment, fulfilmentDueAt: due.toISOString(), total: '1000000',
    })]);
    await drainAll();
  }
  /** Other suites leave undelivered events behind (their dispatcher is off too): drain until nothing is left. */
  async function drainAll() {
    // a batch of others' failing events delivers nothing but must not stop the drain (they wait for a retry)
    for (let i = 0; i < 200; i++) {
      const r = await dispatcher.drain();
      if (r.dispatched + r.failed + r.givenUp === 0) break;
    }
  }
  const handover = async (id: string) =>
    (await fx.query<{ status: string; wrong_entries: number; code_version: number }>(`SELECT status, wrong_entries, code_version FROM delivery.handovers WHERE order_id = $1`, [id]))[0];
  const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
  const reason = (r: Response) => r.json().then((b: { errors?: { reason: string; attemptsLeft?: number }[] }) => b.errors?.[0]);

  it('FR-DLV-05 FR-DLV-03 a paid self-pickup order gets its handover; the buyer alone sees the code; three nearby public points are suggested', async () => {
    const o = await paidOrder();
    expect(await handover(o.id)).toEqual({ status: 'arranging', wrong_entries: 0, code_version: 1 });
    await paidEvent(o.id, o.buyer.userId, o.seller.userId, 'self_pickup', new Date()); // redelivered: nothing changes
    const courier = await paidOrder({ fulfilment: 'courier' });
    expect(await handover(courier.id)).toBeUndefined();

    const b = await o.buyer.json<View>('GET', `/orders/${o.id}/handover`);
    expect(b).toMatchObject({ role: 'buyer', status: 'arranging', attemptsLeft: null });
    expect(b.code).toMatch(/^\d{6}$/);
    // DV-27: the three nearest the snapped midpoint (in the grid's order), never the far one
    expect(b.suggestions.map((p) => p.id).sort()).toEqual(points.slice(0, 3).sort());
    expect(b.suggestions[0].mapUrl).toMatch(/^https:\/\/www\.openstreetmap\.org\/\?mlat=/);
    expect(JSON.stringify(b)).not.toMatch(/midpoint|km_from/);
    expect((await o.buyer.json<View>('GET', `/orders/${o.id}/handover`)).code).toBe(b.code); // derived: the same on reload
    const s = await o.seller.json<View>('GET', `/orders/${o.id}/handover`);
    expect(s).toMatchObject({ role: 'seller', code: null, attemptsLeft: 5 });
    expect((await (await member()).call('GET', `/orders/${o.id}/handover`)).status).toBe(404);

    // moving one party about 300 m changes neither the suggestions nor their order (the grid of DV-27)
    await fx.query(`UPDATE identity.users SET approx_lat = approx_lat + 0.003 WHERE id = $1`, [o.buyer.userId]);
    expect((await o.buyer.json<View>('GET', `/orders/${o.id}/handover`)).suggestions.map((p) => p.id)).toEqual(b.suggestions.map((p) => p.id));
  });

  it('FR-DLV-04 either party proposes a point and time; only the other answers; a new proposal replaces the open one', async () => {
    const o = await paidOrder();
    const at = inHours(5);
    const tooSoon = await o.buyer.call('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[0], meetAt: inHours(0.5) });
    expect(await reason(tooSoon)).toEqual({ field: 'meetAt', reason: 'meetup_time_out_of_range' });
    const v = await o.buyer.json<View>('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[0], meetAt: at, note: 'At the main gate' }, 201);
    const pid = v.proposals[0].id;
    expect(v.proposals[0]).toMatchObject({ status: 'proposed', byMe: true });
    expect((await o.buyer.call('POST', `/orders/${o.id}/meetup-proposals/${pid}/accept`)).status).toBe(403); // not one's own
    const agreed = await o.seller.json<View & { outcome: string }>('POST', `/orders/${o.id}/meetup-proposals/${pid}/accept`);
    expect(agreed).toMatchObject({ outcome: 'accepted', status: 'agreed', agreed: { meetAt: at } });

    // a reschedule keeps the agreement until it is accepted; the seller's new one replaces nothing agreed
    const v2 = await o.seller.json<View>('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[1], meetAt: inHours(8) }, 201);
    expect(v2).toMatchObject({ status: 'agreed', agreed: { meetAt: at } });
    const v3 = await o.buyer.json<View>('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[2], meetAt: inHours(9) }, 201);
    expect(v3.proposals.filter((p) => p.status === 'proposed')).toHaveLength(1);
    expect(v3.proposals.map((p) => p.status).sort()).toEqual(['accepted', 'proposed', 'superseded']);
    const open = v3.proposals.find((p) => p.status === 'proposed')!.id;
    expect((await o.seller.call('POST', `/orders/${o.id}/meetup-proposals/${open}/withdraw`)).status).toBe(403);
    expect((await o.buyer.json<View>('POST', `/orders/${o.id}/meetup-proposals/${open}/withdraw`)).proposals.find((p) => p.id === open)?.status).toBe('withdrawn');
    expect(await reason(await o.buyer.call('POST', `/orders/${o.id}/meetup-proposals/${open}/withdraw`))).toEqual({ field: 'proposalId', reason: 'proposal_closed' });

    const declined = await o.buyer.json<View>('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[0], meetAt: inHours(10) }, 201);
    const d = declined.proposals.find((p) => p.status === 'proposed')!.id;
    expect((await o.seller.json<{ outcome: string }>('POST', `/orders/${o.id}/meetup-proposals/${d}/decline`)).outcome).toBe('declined');

    const adm = await admin();
    expect((await adm.call('PATCH', `/admin/meetup-points/${points[3]}`, { active: false })).status).toBe(200);
    expect(await reason(await o.buyer.call('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[3], meetAt: inHours(6) }))).toEqual({ field: 'pointId', reason: 'point_not_active' });
    expect((await (await member()).call('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[0], meetAt: inHours(6) })).status).toBe(404);
  });

  it('FR-DLV-04 the parties may agree on a place of their own, with or without a map pin; the other must still accept', async () => {
    const o = await paidOrder();
    type P = { id: string; status: string; point: unknown; place: { name: string; lat: number | null; mapUrl: string | null } | null };
    const v = await o.seller.json<{ proposals: P[] }>('POST', `/orders/${o.id}/meetup-proposals`,
      { placeName: 'Coffee shop at the Zindabazar junction', placeLat: 24.8951234, placeLng: 91.8681234, meetAt: inHours(6) }, 201);
    expect(v.proposals[0]).toMatchObject({ status: 'proposed', point: null, place: { name: 'Coffee shop at the Zindabazar junction', lat: 24.89512 } });
    expect(v.proposals[0].place?.mapUrl).toMatch(/openstreetmap/);
    const agreed = await o.buyer.json<{ status: string; agreed: { place: { name: string } | null; point: unknown } }>('POST', `/orders/${o.id}/meetup-proposals/${v.proposals[0].id}/accept`);
    expect(agreed).toMatchObject({ status: 'agreed', agreed: { point: null, place: { name: 'Coffee shop at the Zindabazar junction' } } });

    const noPin = await o.buyer.json<{ proposals: P[] }>('POST', `/orders/${o.id}/meetup-proposals`, { placeName: 'Main gate of the mosque', meetAt: inHours(7) }, 201);
    expect(noPin.proposals[0].place).toEqual({ name: 'Main gate of the mosque', lat: null, lng: null, mapUrl: null });
    expect((await o.buyer.call('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[0], placeName: 'Cafe', meetAt: inHours(7) })).status).toBe(400);
    expect((await o.buyer.call('POST', `/orders/${o.id}/meetup-proposals`, { meetAt: inHours(7) })).status).toBe(400);
    expect((await o.buyer.call('POST', `/orders/${o.id}/meetup-proposals`, { placeName: 'Abroad', placeLat: 40, placeLng: 91, meetAt: inHours(7) })).status).toBe(400);
  });

  it('FR-DLV-06 the seller\'s correct entry of the buyer\'s code completes the handover and is the delivery event, in one transaction', async () => {
    const o = await paidOrder();
    const { code } = await o.buyer.json<View>('GET', `/orders/${o.id}/handover`);
    expect((await o.buyer.call('POST', `/orders/${o.id}/handover-code`, { code })).status).toBe(403); // the seller enters it
    const wrong = await o.seller.call('POST', `/orders/${o.id}/handover-code`, { code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(422);
    expect(await reason(wrong)).toEqual({ field: 'code', reason: 'wrong_code', attemptsLeft: 4 });
    expect(await handover(o.id)).toMatchObject({ wrong_entries: 1 }); // the refusal did not undo the count
    const done = await o.seller.json<{ status: string; completedAt: string }>('POST', `/orders/${o.id}/handover-code`, { code });
    expect(done.status).toBe('completed');

    const [r] = await fx.query<{ step: Date | null; event: Date | null; source: string; window: Date | null }>(
      `SELECT o.fulfilment_done_at AS step, o.delivery_event_at AS event, o.delivery_event_source AS source, e.dispute_window_ends_at AS window
         FROM orders.orders o JOIN orders.escrows e ON e.order_id = o.id WHERE o.id = $1`, [o.id]);
    expect(r.source).toBe('handover_code');
    expect(r.step?.toISOString()).toBe(done.completedAt);
    expect(r.event?.toISOString()).toBe(done.completedAt);
    expect(r.window).not.toBeNull(); // the dispute window starts now (FR-PAY-07)
    expect(await fx.query(`SELECT correct FROM delivery.code_entries WHERE order_id = $1 ORDER BY id`, [o.id])).toEqual([{ correct: false }, { correct: true }]);
    expect(await fx.query(`SELECT 1 FROM delivery.outbox WHERE event_type = 'delivery.handover.completed' AND aggregate_id = $1`, [o.id])).toHaveLength(1);
    expect((await o.buyer.json<View>('GET', `/orders/${o.id}/handover`)).code).toBeNull(); // closed: no code any more
    expect(await reason(await o.seller.call('POST', `/orders/${o.id}/handover-code`, { code }))).toEqual({ field: 'handover', reason: 'handover_closed' });
  });

  it('CP-45 five wrong entries lock the code and open an issue; an operator\'s unlock issues a new code', async () => {
    const o = await paidOrder();
    const { code } = await o.buyer.json<View>('GET', `/orders/${o.id}/handover`);
    const bad = code === '123456' ? '654321' : '123456';
    for (let i = 4; i >= 1; i--) expect(await reason(await o.seller.call('POST', `/orders/${o.id}/handover-code`, { code: bad }))).toMatchObject({ reason: 'wrong_code', attemptsLeft: i });
    expect(await reason(await o.seller.call('POST', `/orders/${o.id}/handover-code`, { code: bad }))).toEqual({ field: 'code', reason: 'code_locked' });
    expect(await handover(o.id)).toEqual({ status: 'locked', wrong_entries: 5, code_version: 1 });
    expect(await reason(await o.seller.call('POST', `/orders/${o.id}/handover-code`, { code }))).toEqual({ field: 'code', reason: 'code_locked' }); // even the right one
    expect(await fx.query(`SELECT status FROM delivery.issues WHERE order_id = $1 AND kind = 'code_locked'`, [o.id])).toEqual([{ status: 'open' }]);

    const op = await admin('operator');
    expect((await op.call('POST', `/staff/orders/${o.id}/handover/unlock`, { reason: 'short' })).status).toBe(400);
    expect((await o.seller.call('POST', `/staff/orders/${o.id}/handover/unlock`, { reason: 'Spoke to both parties by phone.' })).status).toBe(401);
    expect((await op.call('POST', `/staff/orders/${o.id}/handover/unlock`, { reason: 'Spoke to both parties by phone.' })).status).toBe(204);
    expect(await handover(o.id)).toEqual({ status: 'arranging', wrong_entries: 0, code_version: 2 });
    expect(await fx.query(`SELECT status, resolved_by FROM delivery.issues WHERE order_id = $1 AND kind = 'code_locked'`, [o.id])).toEqual([{ status: 'resolved', resolved_by: op.staffId }]);
    const fresh = (await o.buyer.json<View>('GET', `/orders/${o.id}/handover`)).code!;
    expect(fresh).not.toBe(code);
    expect(await reason(await o.seller.call('POST', `/orders/${o.id}/handover-code`, { code }))).toMatchObject({ reason: 'wrong_code', attemptsLeft: 4 }); // the old code is gone
    expect((await o.seller.json<{ status: string }>('POST', `/orders/${o.id}/handover-code`, { code: fresh })).status).toBe('completed');
    expect((await op.call('POST', `/staff/orders/${o.id}/handover/unlock`, { reason: 'Spoke to both parties by phone.' })).status).toBe(400); // not locked
  });

  it('FR-PAY-08 an entry at or after the deadline is refused; a refund cancels the handover', async () => {
    const late = await paidOrder({ dueIn: '-1 minute' });
    const { code } = await late.buyer.json<View>('GET', `/orders/${late.id}/handover`);
    expect(await reason(await late.seller.call('POST', `/orders/${late.id}/handover-code`, { code }))).toEqual({ field: 'code', reason: 'deadline_passed' });

    const o = await paidOrder();
    await o.buyer.json('POST', `/orders/${o.id}/meetup-proposals`, { pointId: points[0], meetAt: inHours(5) }, 201);
    await fx.query(`INSERT INTO orders.outbox (event_type, aggregate_id, payload) VALUES ('orders.escrow.refunded', $1, $2)`, [o.id, JSON.stringify({ orderId: o.id })]);
    await drainAll();
    expect(await handover(o.id)).toMatchObject({ status: 'cancelled' });
    const v = await o.buyer.json<View>('GET', `/orders/${o.id}/handover`);
    expect(v).toMatchObject({ status: 'cancelled', code: null, suggestions: [] });
    expect(v.proposals[0].status).toBe('superseded');
  });

  it('FR-DLV-03 administrators maintain the meetup points; operators and users cannot', async () => {
    const adm = await admin();
    const op = await admin('operator');
    const point = { kind: 'police_station', nameEn: 'Kotwali Police Station (test)', nameBn: 'কোতোয়ালী থানা', district: 'Sylhet', lat: 24.8912345, lng: 91.8712345 };
    expect((await op.call('POST', '/admin/meetup-points', point)).status).toBe(403);
    expect((await adm.call('POST', '/admin/meetup-points', { ...point, lat: 30 })).status).toBe(400);
    const r = await adm.call('POST', '/admin/meetup-points', point);
    const p = (await r.json()) as { id: string; lat: number; guidance: string | null };
    expect(p).toMatchObject({ lat: 24.89123, guidance: null });
    expect(await (await adm.call('PATCH', `/admin/meetup-points/${p.id}`, { guidance: 'Inside the guarded forecourt' })).json()).toMatchObject({ guidance: 'Inside the guarded forecourt', nameEn: point.nameEn });
    const list = (await (await adm.call('GET', '/admin/meetup-points')).json()) as { items: { id: string }[] };
    expect(list.items.some((x) => x.id === p.id)).toBe(true);
    expect(await fx.query(`SELECT 1 FROM audit.events WHERE action LIKE 'delivery.meetup_point.%' AND object_id = $1`, [p.id])).toHaveLength(2);
  });
});
