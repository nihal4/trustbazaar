import { randomInt, randomUUID } from 'crypto';
import { EventBus, OutboxEvent } from '../../src/kernel/events/event-bus';
import { LISTINGS_COMMANDS, ListingsCommands } from '../../src/modules/listings/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U5-02, second part: the operator's review of ownership proofs, the player-ID claim and publication through Unit 3's
// ListingsCommands (docs/design/05_game_accounts.pdf sections 3, 5.2 and 5.3; FR-GAM-03, FR-GAM-04, FR-OPS-01), against
// PostgreSQL through the real security pipeline. Events are handed to their consumers as the outbox dispatcher would.
describe('ownership review: the operator\'s decision, the player-ID claim and publication', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let bus: EventBus;
  let category: number;
  let game: { id: number };

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    bus = t.app.get(EventBus);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Game accounts', 'গেম অ্যাকাউন্ট', 'game_account') RETURNING id`,
      [`review-${randomUUID().slice(0, 8)}`],
    );
    const admin = await staff('administrator');
    game = (await (await admin.call('POST', '/admin/games', {
      slug: `codm-${randomUUID().slice(0, 6)}`, name: 'Call of Duty Mobile', platforms: ['android', 'ios'], codePlacement: 'the profile bio', publisherNote: 'The publisher does not allow account transfers.',
    })).json()) as { id: number };
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  function call(headers: Record<string, string>) {
    return (method: string, path: string, body?: unknown) => fetch(t.url(path), {
      method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function staff(role: 'operator' | 'administrator') {
    const staffId = await fx.staff(role);
    return { staffId, call: call(fx.headers(await fx.session({ staffId }), staffId, 'staff')) };
  }
  async function member() {
    const userId = await fx.user();
    const headers = { ...fx.headers(await fx.session({ userId }), userId, 'user'), 'x-forwarded-for': `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}` };
    const upload = async (path: string, bytes: Buffer) => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'proof');
      return fetch(t.url(path), { method: 'POST', headers, body: form });
    };
    return { userId, call: call(headers), upload };
  }
  type Member = Awaited<ReturnType<typeof member>>;
  const png = () => sharp({ create: { width: 320, height: 200, channels: 3, background: '#573' } }).png().toBuffer();
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;
  const playerId = () => `${randomInt(1000, 9999)} ${randomInt(1000, 9999)}`;

  /** A game-account listing by the seller, published through Unit 3 (held for review), with details, a code and a proof. */
  async function submitted(seller: Member, player: string, publish: Record<string, unknown> = {}, format: 'fixed_price' | 'auction' = 'fixed_price') {
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price, quantity_total, quantity_available)
       VALUES ($1, 'game_account', $2, $3, 'CODM account, legendary rank', 'An account with legendary rank, written by the review tests.', $4, 1, 1) RETURNING id`,
      [seller.userId, format, category, format === 'auction' ? null : 300000],
    );
    expect((await seller.call('PUT', `/listings/${listingId}/game-details`, { gameId: game.id, platform: 'android', playerId: player, contents: 'Legendary rank, two mythic weapons.' })).status).toBe(200);
    const pub = await seller.call('POST', `/listings/${listingId}/publish`, publish);
    expect([pub.status, ((await pub.json()) as { status: string }).status]).toEqual([200, 'pending_review']);
    expect((await seller.call('POST', `/listings/${listingId}/ownership-code`)).status).toBe(201);
    expect((await seller.upload(`/listings/${listingId}/ownership-proof`, await png())).status).toBe(201);
    const [{ id: proofId }] = await fx.query<{ id: string }>(`SELECT id FROM game_accounts.ownership_proofs WHERE listing_id = $1 AND status = 'submitted'`, [listingId]);
    return { listingId, proofId };
  }
  const listing = async (id: string) => (await fx.query<{ status: string }>(`SELECT status FROM listings.listings WHERE id = $1`, [id]))[0].status;
  const liveClaims = (listingId: string) => fx.query(`SELECT released_at, release_reason FROM game_accounts.claims WHERE listing_id = $1`, [listingId]);
  const event = (type: string, aggregateId: string, payload: Record<string, unknown>): OutboxEvent => ({ outbox: 'auctions', id: String(randomInt(1, 2 ** 31)), type, aggregateId, payload, createdAt: new Date(), attempt: 1 });
  const consume = async (consumer: string, e: OutboxEvent) => bus.consumersOf(e.type).find((c) => c.name === consumer)!.handler(e);

  it('FR-GAM-03 FR-GAM-04 FR-OPS-01 an operator sees the proof in the queue, views the screenshot and approves it: the claim is taken and the listing goes live', async () => {
    const seller = await member();
    const { listingId, proofId } = await submitted(seller, playerId());
    const [op, conflicted] = [await staff('operator'), await staff('operator')];
    const queue = (await (await op.call('GET', '/staff/game/ownership-proofs')).json()) as { items: { proofId: string }[] };
    expect(queue.items.find((i) => i.proofId === proofId)).toMatchObject({ listingId, sellerId: seller.userId, game: 'Call of Duty Mobile', platform: 'android', submittedAt: expect.any(String) });
    const console = (await (await op.call('GET', '/staff/queues/ownership_proofs')).json()) as { items: { id: string; path: string }[] };
    expect(console.items.find((i) => i.id === proofId)).toMatchObject({ status: 'submitted', path: `/staff/game/ownership-proofs/${proofId}/review` });
    const link = (await (await op.call('GET', `/staff/game/ownership-proofs/${proofId}/screenshot`)).json()) as { url: string };
    expect(link.url).toEqual(expect.any(String));
    expect((await seller.call('GET', '/staff/game/ownership-proofs')).status).toBe(401);

    expect((await conflicted.call('POST', '/staff/conflicts', { userId: seller.userId, reason: 'The seller is my cousin.' })).status).toBe(204);
    expect((await conflicted.call('GET', `/staff/game/ownership-proofs/${proofId}/screenshot`)).status).toBe(403);
    expect((await conflicted.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'approve', liveCheck: 'matched' })).status).toBe(403);
    expect(await errors(await op.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'approve', liveCheck: 'not_matched' })))
      .toEqual([{ field: 'liveCheck', reason: 'live-check-not-matched' }]); // a screenshot alone can be faked

    const r = await op.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'approve', liveCheck: 'matched' });
    expect([r.status, await r.json()]).toEqual([200, { status: 'approved' }]);
    expect(await listing(listingId)).toBe('active');
    expect(await liveClaims(listingId)).toEqual([{ released_at: null, release_reason: null }]);
    expect(await fx.query(`SELECT status, reviewed_by, live_check FROM game_accounts.ownership_proofs WHERE id = $1`, [proofId])).toEqual([{ status: 'approved', reviewed_by: op.staffId, live_check: 'matched' }]);
    expect(await fx.query(`SELECT from_status, to_status, actor_type, actor_id FROM listings.status_history WHERE listing_id = $1 ORDER BY at, id`, [listingId]))
      .toEqual(expect.arrayContaining([{ from_status: 'pending_review', to_status: 'active', actor_type: 'staff', actor_id: op.staffId }]));
    expect(await fx.query(`SELECT event_type FROM auctions.outbox WHERE aggregate_id = $1 AND event_type = 'listings.listing.published'`, [listingId])).toHaveLength(1);
    expect(await fx.query(`SELECT event_type FROM game_accounts.outbox WHERE aggregate_id = $1`, [listingId])).toEqual([{ event_type: 'game_accounts.ownership.approved' }]);
    expect(await fx.query(`SELECT action FROM audit.events WHERE object_id = $1 AND action LIKE 'games.ownership.%'`, [listingId])).toEqual([{ action: 'games.ownership.approved' }]);
    expect(await errors(await op.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'reject', liveCheck: 'matched', reason: 'Changed my mind about it.' })))
      .toEqual([{ field: 'proof', reason: 'not-awaiting-review' }]); // a reviewed proof is final
  });

  it('FR-GAM-03 a rejection needs a reason; the listing returns to draft and the seller is told why', async () => {
    const seller = await member();
    const { listingId, proofId } = await submitted(seller, playerId());
    const op = await staff('operator');
    expect(await errors(await op.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'reject', liveCheck: 'not_matched' }))).toEqual([{ field: 'reason', reason: 'required' }]);
    const reason = 'The code is not visible on the profile.';
    expect(await (await op.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'reject', liveCheck: 'not_matched', reason })).json()).toEqual({ status: 'rejected' });
    expect(await listing(listingId)).toBe('draft');
    expect(await liveClaims(listingId)).toEqual([]);
    expect(await (await seller.call('GET', `/listings/${listingId}/ownership`)).json()).toMatchObject({ proof: { status: 'rejected', reason } });
    const [{ id, payload }] = await fx.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id::text, payload FROM game_accounts.outbox WHERE aggregate_id = $1`, [listingId]);
    await consume('chat.notifications', { outbox: 'game_accounts', id, type: 'game_accounts.ownership.rejected', aggregateId: listingId, payload, createdAt: new Date(), attempt: 1 });
    expect(await fx.query(`SELECT template_code, params FROM notify.notifications WHERE user_id = $1 AND template_code = 'listing.ownership_rejected'`, [seller.userId]))
      .toEqual([{ template_code: 'listing.ownership_rejected', params: { listing_title: 'CODM account, legendary rank', reason } }]);
    // the seller corrects it: publishes again, a new code, a new screenshot
    expect((await seller.call('POST', `/listings/${listingId}/publish`, {})).status).toBe(200);
    expect((await seller.call('POST', `/listings/${listingId}/ownership-code`)).status).toBe(201);
    expect((await seller.upload(`/listings/${listingId}/ownership-proof`, await png())).status).toBe(201);
  });

  it('FR-GAM-04 one live claim per game and player ID, compared without spaces or case; ten operators approving at once give one approval; an unsold listing releases its claim', async () => {
    const player = `Ab ${randomInt(100000, 999999)}`;
    const sellers = await Promise.all(Array.from({ length: 10 }, () => member()));
    const proofs: { listingId: string; proofId: string }[] = [];
    for (const [i, s] of sellers.entries()) proofs.push(await submitted(s, i % 2 ? player.toLowerCase().replace(' ', '') : player));
    const ops = await Promise.all(proofs.map(() => staff('operator')));
    const answers = await Promise.all(proofs.map((p, i) => ops[i].call('POST', `/staff/game/ownership-proofs/${p.proofId}/review`, { decision: 'approve', liveCheck: 'not_available' })));
    expect(answers.map((a) => a.status).sort()).toEqual([200, ...Array(9).fill(400)]);
    const winner = proofs[answers.findIndex((a) => a.status === 200)];
    const loser = proofs.find((p) => p !== winner)!;
    expect(await errors(await ops[0].call('POST', `/staff/game/ownership-proofs/${loser.proofId}/review`, { decision: 'approve', liveCheck: 'matched' })))
      .toEqual([{ field: 'playerId', reason: 'player-id-claimed' }]);
    expect(await listing(loser.listingId)).toBe('pending_review'); // nothing changed: still awaiting review

    // the winner's listing ends unsold: its claim is released (once), and the next proof can be approved
    const ended = event('listings.listing.ended_unsold', winner.listingId, { listingId: winner.listingId, itemKind: 'game_account' });
    await consume('game_accounts.claims', ended);
    await consume('game_accounts.claims', ended);
    expect(await liveClaims(winner.listingId)).toEqual([{ released_at: expect.any(Date), release_reason: 'listing_ended' }]);
    expect((await ops[0].call('POST', `/staff/game/ownership-proofs/${loser.proofId}/review`, { decision: 'approve', liveCheck: 'matched' })).status).toBe(200);
    await consume('game_accounts.claims', event('listings.listing.cancelled', loser.listingId, { listingId: loser.listingId, itemKind: 'physical' })); // not a game account
    expect(await liveClaims(loser.listingId)).toEqual([{ released_at: null, release_reason: null }]);
  });

  it('FR-GAM-03 DV-33 a code that expired while awaiting review cannot be approved; the operator rejects it', async () => {
    const seller = await member();
    const [{ id: listingId }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price, quantity_total, quantity_available, status)
       VALUES ($1, 'game_account', 'fixed_price', $2, 'CODM account, epic rank', 'An account with epic rank, written by the review tests.', 200000, 1, 1, 'pending_review') RETURNING id`,
      [seller.userId, category],
    );
    await seller.call('PUT', `/listings/${listingId}/game-details`, { gameId: game.id, platform: 'ios', playerId: playerId(), contents: 'Epic rank, one mythic weapon.' });
    await fx.query(`INSERT INTO game_accounts.ownership_proofs (listing_id, code, issued_at, expires_at) VALUES ($1, $2, now() - interval '7 days', now() + interval '2 seconds')`,
      [listingId, `TB-${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`]); // issued a week ago, valid two more seconds
    expect((await seller.upload(`/listings/${listingId}/ownership-proof`, await png())).status).toBe(201);
    const [{ id: proofId }] = await fx.query<{ id: string }>(`SELECT id FROM game_accounts.ownership_proofs WHERE listing_id = $1`, [listingId]);
    await new Promise((r) => setTimeout(r, 2500));
    const op = await staff('operator');
    expect(await errors(await op.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'approve', liveCheck: 'matched' }))).toEqual([{ field: 'code', reason: 'code-expired' }]);
    expect((await op.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'reject', liveCheck: 'not_available', reason: 'The code expired before the review.' })).status).toBe(200);
  });

  it('FR-LST-12 a held auction returned to draft takes new terms when published again; approval restarts its clock', async () => {
    const seller = await member();
    const { listingId, proofId } = await submitted(seller, playerId(), { startPrice: '100000', duration: '24 hours' }, 'auction');
    const op = await staff('operator');
    await op.call('POST', `/staff/game/ownership-proofs/${proofId}/review`, { decision: 'reject', liveCheck: 'not_matched', reason: 'The player ID on the screenshot differs.' });
    expect(await listing(listingId)).toBe('draft');
    expect((await seller.call('POST', `/listings/${listingId}/publish`, { startPrice: '150000', duration: '6 hours' })).status).toBe(200);
    await fx.query(`UPDATE auctions.auctions SET starts_at = starts_at - interval '2 days', original_end_at = original_end_at - interval '2 days', end_at = end_at - interval '2 days' WHERE listing_id = $1`, [listingId]);
    const commands = t.app.get<ListingsCommands>(LISTINGS_COMMANDS);
    expect(await commands.returnToDraft(randomUUID(), op.staffId, 'not held')).toBe(false);
    await commands.approveForPublication(listingId, op.staffId, 'checked by hand');
    expect(await fx.query(`SELECT start_price, extract(epoch FROM end_at - starts_at)::int AS secs, starts_at > now() - interval '1 minute' AS restarted FROM auctions.auctions WHERE listing_id = $1`, [listingId]))
      .toEqual([{ start_price: '150000', secs: 6 * 3600, restarted: true }]);
    await expect(commands.approveForPublication(listingId, op.staffId, 'again')).rejects.toMatchObject({ problem: 'listing-state' });
  });
});
