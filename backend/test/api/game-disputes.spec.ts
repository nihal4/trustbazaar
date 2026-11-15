import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { DISCLOSURE_VERSION } from '../../src/modules/game-accounts/ports';
import { GameJobsService } from '../../src/modules/game-accounts/services/game-jobs.service';
import { createHash } from 'crypto';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';
import { b64, BuyerKey, generateBuyerKey, seal } from '../support/sealed';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U7-10: game-account disputes (docs/design/07_disputes_trust_staff.pdf sections 5.1 to 5.4 and 5.7; FR-DSP-01,
// FR-DSP-05, FR-DSP-10, FR-GAM-14, FR-GAM-16, DV-37), against PostgreSQL through the real security pipeline, with the
// mock payment provider and real sealing (test/support/sealed.ts). Events are handed to their consumers as the outbox
// dispatcher would.
describe('game-account disputes: the report, the overdue re-key, the protection period and the case file', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let bus: EventBus;
  let category: number;
  let gameId: number;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Game accounts', 'গেম অ্যাকাউন্ট', 'game_account') RETURNING id`,
      [`gdisp-${randomUUID().slice(0, 8)}`],
    );
    [{ id: gameId }] = await fx.query<{ id: number }>(
      `INSERT INTO game_accounts.games (slug, name, platforms, code_placement, publisher_note) VALUES ($1, 'eFootball', '{android,ios}', 'the bio', 'Transfers break the terms.') RETURNING id`,
      [`ef4-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member() {
    const userId = await fx.user();
    const sessionId = await fx.session({ userId });
    const headers = { ...fx.headers(sessionId, userId, 'user'), 'x-forwarded-for': `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}` };
    const call = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => fetch(t.url(path), {
      method, headers: { ...headers, ...extra, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const upload = (path: string, bytes: Buffer) => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'evidence');
      return fetch(t.url(path), { method: 'POST', headers, body: form });
    };
    return { userId, sessionId, call, upload };
  }
  type Member = Awaited<ReturnType<typeof member>>;
  const consume = (e: OutboxEvent) => bus.consumersOf(e.type).find((c) => c.name === 'game_accounts.handover')!.handler(e);
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;

  /** A paid game-account order: the listing approved, the disclosure and the buyer's key, the mock payment, the request for credentials. */
  async function paidOrder(): Promise<{ seller: Member; buyer: Member; orderId: string; listingId: string; key: BuyerKey }> {
    const [seller, buyer] = [await member(), await member()];
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price, quantity_total, quantity_available)
       VALUES ($1, 'game_account', 'fixed_price', $2, 'eFootball account, division 1', 'A division-1 account, written by the handover tests.', 250000, 1, 1) RETURNING id`,
      [seller.userId, category],
    );
    const player = String(randomInt(10_000_000, 99_999_999));
    await fx.query(`INSERT INTO game_accounts.details (listing_id, seller_id, game_id, platform, player_id, contents) VALUES ($1, $2, $3, 'ios', $4, 'Division 1, three epic players.')`, [listingId, seller.userId, gameId, player]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);
    await fx.query(`INSERT INTO game_accounts.claims (game_id, player_id_norm, listing_id) VALUES ($1, $2, $3)`, [gameId, player, listingId]);
    const { id: orderId } = (await (await buyer.call('POST', '/orders', { listingId, quantity: 1 })).json()) as { id: string };
    await buyer.call('POST', `/orders/${orderId}/game/acknowledge`, { version: DISCLOSURE_VERSION });
    const key = await generateBuyerKey();
    expect((await buyer.call('POST', `/orders/${orderId}/game/key`, { publicKey: b64(key.publicRaw) })).status).toBe(201);
    const p = (await (await buyer.call('POST', `/orders/${orderId}/payments`, { provider: 'bkash' }, { 'idempotency-key': randomUUID() })).json()) as { redirectUrl: string };
    const page = new URL(p.redirectUrl);
    const form = await fetch(t.url(page.pathname.replace('/api/v1', '') + page.search), {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=succeeded',
    });
    const cb = new URL(form.headers.get('location')!);
    await fetch(t.url(cb.pathname.replace('/api/v1', '') + cb.search), { redirect: 'manual' });
    const [paid] = await fx.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id::text, payload FROM orders.outbox WHERE aggregate_id = $1 AND event_type = 'orders.order.paid'`, [orderId]);
    await consume({ outbox: 'orders', id: paid.id, type: 'orders.order.paid', aggregateId: orderId, payload: paid.payload, createdAt: new Date(), attempt: 1 });
    return { seller, buyer, orderId, listingId, key };
  }
  const credentials = { loginId: 'player@example.com', password: 'Correct-Horse-Battery-9', recovery: ['8F2K-11QX', '9Z3M-22RW'], note: 'Linked to no phone.' };

  /** A paid order with the credentials delivered for the buyer's key. */
  async function delivered() {
    const o = await paidOrder();
    const sealed = await seal(o.key.publicRaw, o.orderId, 1, credentials);
    expect((await o.seller.call('POST', `/orders/${o.orderId}/game/sealed`, { keyVersion: 1, enc: b64(sealed.enc), ciphertext: b64(sealed.ciphertext) })).status).toBe(201);
    return o;
  }
  const step = (b: Member, orderId: string, s: string) => b.call('POST', `/orders/${orderId}/game/takeover-steps/${s}`);

  async function operator() {
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    const h = fx.headers(sid, staffId, 'staff');
    return {
      staffId,
      call: (method: string, path: string, body?: unknown) => fetch(t.url(path), {
        method, headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
      }),
    };
  }
  const handover = async (orderId: string) => (await fx.query<{ status: string }>(`SELECT status FROM game_accounts.handovers WHERE order_id = $1`, [orderId]))[0].status;
  const escrow = async (orderId: string) => (await fx.query<{ state: string }>(`SELECT state FROM orders.escrows WHERE order_id = $1`, [orderId]))[0].state;
  const reason = 'The seller took the account back the day after the takeover; the log shows it.';

  it('FR-GAM-14 FR-DSP-10 "the credentials do not work" opens a credentials_invalid dispute and freezes the escrow; withdrawn, the takeover resumes and that type cannot be opened again', async () => {
    const { buyer, orderId } = await delivered();
    expect(await errors(await buyer.call('POST', `/orders/${orderId}/disputes`, { type: 'credentials_invalid', description: 'The password is refused by the game.' })))
      .toEqual([{ field: 'type', reason: 'use-the-handover-report' }]); // the handover's own report
    const r = await buyer.call('POST', `/orders/${orderId}/game/report-invalid`, { description: 'The game says the password is wrong every time.' });
    expect(r.status).toBe(201);
    const { disputeId } = (await r.json()) as { disputeId: string };
    expect([await handover(orderId), await escrow(orderId)]).toEqual(['disputed', 'frozen_disputed']);
    expect(await fx.query(`SELECT type, opened_by, item_kind FROM disputes.disputes WHERE id = $1`, [disputeId])).toEqual([{ type: 'credentials_invalid', opened_by: 'buyer', item_kind: 'game_account' }]);
    expect(await errors(await step(buyer, orderId, 'password'))).toEqual([{ field: 'handover', reason: 'takeover-not-in-progress' }]);

    expect((await buyer.call('POST', `/disputes/${disputeId}/withdraw`)).status).toBe(200);
    expect([await handover(orderId), await escrow(orderId)]).toEqual(['delivered', 'held']); // the takeover resumes
    expect((await step(buyer, orderId, 'password')).status).toBe(200);
    expect((await buyer.call('POST', `/orders/${orderId}/game/report-invalid`, {})).status).toBe(400); // withdrawn type: not again
    expect(await handover(orderId)).toBe('delivered'); // and nothing changed
  });

  it('DV-37 an unanswered re-key becomes a credentials_invalid dispute opened by the system', async () => {
    const { buyer, orderId } = await delivered();
    expect((await buyer.call('POST', `/orders/${orderId}/game/rekey`, { publicKey: b64((await generateBuyerKey()).publicRaw) })).status).toBe(201);
    await fx.query(`UPDATE game_accounts.handovers SET rekey_due_at = now() - interval '1 minute' WHERE order_id = $1`, [orderId]);
    expect(await t.app.get(GameJobsService).disputeOverdueRekeys()).toBeGreaterThanOrEqual(1);
    expect(await handover(orderId)).toBe('disputed');
    expect(await fx.query(`SELECT type, opened_by FROM disputes.disputes WHERE order_id = $1`, [orderId])).toEqual([{ type: 'credentials_invalid', opened_by: 'system' }]);
    expect(await escrow(orderId)).toBe('frozen_disputed');
  });

  it('FR-GAM-16 FR-DSP-01 FR-DSP-05 seller_recovery and other only in the protection period; the case file carries Unit 5\'s evidence without credentials; a refund ends the handover', async () => {
    const { seller, buyer, orderId, listingId } = await delivered();
    expect(await (await buyer.call('GET', `/orders/${orderId}/dispute-types`)).json()).toEqual({ types: [], openDisputeId: null }); // not taken over yet
    expect(await errors(await buyer.call('POST', `/orders/${orderId}/disputes`, { type: 'seller_recovery', description: reason }))).toEqual([{ field: 'type', reason: 'dispute-not-allowed' }]);
    expect(await errors(await buyer.call('POST', `/orders/${orderId}/disputes`, { type: 'not_received', description: reason }))).toEqual([{ field: 'type', reason: 'not-for-this-item' }]);
    await buyer.call('GET', `/orders/${orderId}/game/sealed`);
    for (const s of ['password', 'recovery_email', 'recovery_phone', 'social_logins', 'two_step']) expect((await step(buyer, orderId, s)).status).toBe(200);
    expect(await (await buyer.call('GET', `/orders/${orderId}/dispute-types`)).json()).toEqual({ types: ['seller_recovery', 'other'], openDisputeId: null });
    const opened = await buyer.call('POST', `/orders/${orderId}/disputes`, { type: 'seller_recovery', description: reason });
    expect(opened.status).toBe(201);
    const { disputeId } = (await opened.json()) as { disputeId: string };
    expect(await handover(orderId)).toBe('taken_over'); // the handover is over; the dispute is about the protection period

    const op = await operator();
    expect((await seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'I did not touch the account after the sale.' })).status).toBe(201); // the review starts
    expect((await op.call('POST', `/staff/cases/dispute/${disputeId}/claim`)).status).toBe(200);
    const file = (await (await op.call('GET', `/staff/disputes/${disputeId}/case-file`)).json()) as { game: { details: unknown; proof: unknown; handover: { status: string }; confirmations: unknown[]; accessLog: { party: string; network: string }[] } };
    expect(file.game.details).toEqual({ game: 'eFootball', platform: 'ios', playerId: expect.any(String), contents: 'Division 1, three epic players.' });
    expect(file.game.handover).toMatchObject({ status: 'taken_over', takeoverSource: 'checklist', keyVersion: 1 });
    expect(file.game.confirmations).toHaveLength(5);
    expect(file.game.accessLog).toEqual([{ at: expect.any(String), party: 'buyer', sessionId: buyer.sessionId, keyVersion: 1, network: expect.stringMatching(/\.0\/24$|::\/48$/) }]);
    expect(JSON.stringify(file)).not.toMatch(/Correct-Horse|ciphertext|publicKey|enc"/); // never the credentials or keys

    expect(await errors(await op.call('POST', `/staff/disputes/${disputeId}/decision`, { outcome: 'refund_after_return', reason, returnPayer: 'seller' })))
      .toEqual([{ field: 'outcome', reason: 'not-for-this-item' }]);
    expect((await op.call('POST', `/staff/disputes/${disputeId}/decision`, { outcome: 'full_refund', reason })).status).toBe(200);
    expect(await escrow(orderId)).toBe('refunded');
    const [e] = await fx.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id::text, payload FROM orders.outbox WHERE aggregate_id = $1 AND event_type = 'orders.escrow.refunded'`, [orderId]);
    await consume({ outbox: 'orders', id: e.id, type: 'orders.escrow.refunded', aggregateId: orderId, payload: e.payload, createdAt: new Date(), attempt: 1 });
    expect(await handover(orderId)).toBe('closed');
    expect(await fx.query(`SELECT release_reason FROM game_accounts.claims WHERE listing_id = $1`, [listingId])).toEqual([{ release_reason: 'escrow_terminal' }]);
  });

  it('FR-GAM-18 the assigned operator exports the evidence pack: one audited PDF, by a signed link, with Unit 5\'s evidence and the hash list, never the credentials', async () => {
    const { seller, buyer, orderId } = await delivered();
    await buyer.call('GET', `/orders/${orderId}/game/sealed`);
    for (const s of ['password', 'recovery_email', 'recovery_phone', 'social_logins', 'two_step']) await step(buyer, orderId, s);
    const { disputeId } = (await (await buyer.call('POST', `/orders/${orderId}/disputes`, { type: 'seller_recovery', description: reason })).json()) as { disputeId: string };
    const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#a33' } }).png().toBuffer();
    expect((await buyer.upload(`/disputes/${disputeId}/evidence`, png)).status).toBe(201);
    await seller.call('POST', `/disputes/${disputeId}/statements`, { text: 'I did not touch the account after the sale.' });
    const [op, other] = [await operator(), await operator()];
    expect((await op.call('GET', `/staff/disputes/${disputeId}/evidence-pack`)).status).toBe(409); // not claimed
    await op.call('POST', `/staff/cases/dispute/${disputeId}/claim`);
    expect((await other.call('GET', `/staff/disputes/${disputeId}/evidence-pack`)).status).toBe(409);
    expect((await buyer.call('GET', `/staff/disputes/${disputeId}/evidence-pack`)).status).toBe(401);

    const r = await op.call('GET', `/staff/disputes/${disputeId}/evidence-pack`);
    expect([r.status, r.headers.get('cache-control')]).toEqual([200, 'no-store']);
    const pack = (await r.json()) as { url: string; expiresAt: string; sha256: string; files: number };
    expect(pack).toMatchObject({ url: expect.stringMatching(/^\/api\/v1\/files\/v\//), files: 1 });
    const file = await op.call('GET', pack.url.replace(/^\/api\/v1/, ''));
    expect(file.status).toBe(200);
    const pdf = Buffer.from(await file.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(pack.sha256);
    expect((await other.call('GET', pack.url.replace(/^\/api\/v1/, ''))).status).not.toBe(200); // the link is the operator's session's
    // the uncompressed PDF writes each line as hex-encoded strings in TJ arrays: read them back as text
    const text = [...pdf.toString('latin1').matchAll(/\[([^\]]*)\] TJ/g)]
      .map((m) => [...m[1].matchAll(/<([0-9a-f]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('')).join('\n');
    const [{ sha }] = await fx.query<{ sha: string }>(`SELECT encode(sha256, 'hex') AS sha FROM disputes.evidence WHERE dispute_id = $1`, [disputeId]);
    for (const part of ['TrustBazaar evidence pack', 'seller_recovery', 'Credential-access log', 'two_step', sha, 'eFootball']) expect(text).toContain(part);
    expect(text).not.toMatch(/Correct-Horse|player@example\.com/); // never the credentials
    expect((await fx.query<{ action: string }>(`SELECT action FROM audit.events WHERE actor_id = $1 AND action IN ('disputes.evidence_pack.created', 'files.file.viewed') ORDER BY id`, [op.staffId])).map((a) => a.action))
      .toEqual(['disputes.evidence_pack.created', 'files.file.viewed']);
  });
});
