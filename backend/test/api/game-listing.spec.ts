import { randomInt, randomUUID } from 'crypto';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U5-02: the games catalogue, a game-account listing's details, the ownership code and the proof upload
// (docs/design/05_game_accounts.pdf section 5; FR-GAM-01 to FR-GAM-03) against PostgreSQL through the real security
// pipeline. Listings are written directly as drafts of the seller's, and held for review where a proof is uploaded. The
// review is test/api/ownership-review.spec.ts.
describe('listing a game account: catalogue, details, ownership code and proof', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;
  let physical: number;
  let admin: { staffId: string; call: ReturnType<typeof call> };
  let game: { id: number; platforms: string[] };

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Game accounts', 'গেম অ্যাকাউন্ট', 'game_account') RETURNING id`,
      [`games-${randomUUID().slice(0, 8)}`],
    );
    [{ id: physical }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Lamps', 'বাতি', 'physical') RETURNING id`,
      [`lamps-${randomUUID().slice(0, 8)}`],
    );
    const staffId = await fx.staff('administrator');
    admin = { staffId, call: call(fx.headers(await fx.session({ staffId }), staffId, 'staff')) };
    const r = await admin.call('POST', '/admin/games', {
      slug: `pubg-${randomUUID().slice(0, 6)}`,
      name: 'PUBG Mobile',
      platforms: ['android', 'ios'],
      codePlacement: 'the profile signature',
      publisherNote: 'The publisher does not allow account transfers.',
    });
    game = (await r.json()) as { id: number; platforms: string[] };
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  function call(headers: Record<string, string>) {
    return (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method,
        headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
  }
  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const headers = { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}` };
    const upload = async (path: string, bytes: Buffer, type = 'image/png') => {
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(bytes)], { type }), 'proof');
      return fetch(t.url(path), { method: 'POST', headers, body: form });
    };
    return { userId, call: call(headers), upload };
  }
  async function gameListing(sellerId: string, kind: 'game_account' | 'physical' = 'game_account') {
    const [{ id }] = await fx.query<{ id: string }>(
      kind === 'game_account'
        ? `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price, quantity_total, quantity_available)
           VALUES ($1, 'game_account', 'fixed_price', $2, 'PUBG account, level 70', 'An account with rare skins, written by the game tests.', 500000, 1, 1) RETURNING id`
        : `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
              fulfilment_options, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
           VALUES ($1, 'physical', 'fixed_price', $2, 'A desk lamp', 'A lamp in good condition, written by the game tests.', 'used', true,
              'pickup_only', 'Dhaka', 23.81, 90.41, 100000, 1, 1) RETURNING id`,
      [sellerId, kind === 'game_account' ? category : physical],
    );
    return id;
  }
  const hold = (listingId: string) => fx.query(`UPDATE listings.listings SET status = 'pending_review' WHERE id = $1`, [listingId]); // as the seller's publication
  const details = (extra: Record<string, unknown> = {}) => ({
    gameId: game.id,
    platform: 'android',
    playerId: '5123 4567',
    contents: 'Level 70, three mythic skins, no linked purchases.',
    ...extra,
  });
  const errors = async (r: Response) => ((await r.json()) as { errors?: unknown[] }).errors;
  const png = () =>
    sharp({ create: { width: 320, height: 200, channels: 3, background: '#357' } })
      .png()
      .toBuffer();

  it('FR-GAM-01 administrators maintain the games catalogue; everyone reads the active games', async () => {
    expect(game).toMatchObject({ name: 'PUBG Mobile', platforms: ['android', 'ios'], active: true });
    const list = (await (await fetch(t.url('/games'))).json()) as { items: { id: number; codePlacement: string }[] };
    expect(list.items.find((g) => g.id === game.id)).toEqual({
      id: game.id,
      slug: expect.any(String),
      name: 'PUBG Mobile',
      platforms: ['android', 'ios'],
      codePlacement: 'the profile signature',
      publisherNote: 'The publisher does not allow account transfers.',
    });
    const [{ slug }] = await fx.query<{ slug: string }>(`SELECT slug FROM game_accounts.games WHERE id = $1`, [game.id]);
    expect(
      await errors(
        await admin.call('POST', '/admin/games', {
          slug,
          name: 'Again',
          platforms: ['pc'],
          codePlacement: 'the bio',
          publisherNote: 'No transfers are allowed.',
        }),
      ),
    ).toEqual([{ field: 'slug', reason: 'taken' }]);
    const other = (await (
      await admin.call('POST', '/admin/games', {
        slug: `ff-${randomUUID().slice(0, 6)}`,
        name: 'Free Fire',
        platforms: ['android'],
        codePlacement: 'the bio',
        publisherNote: 'Transfers break the terms.',
      })
    ).json()) as { id: number };
    expect(await (await admin.call('PATCH', `/admin/games/${other.id}`, { active: false })).json()).toMatchObject({ id: other.id, active: false });
    expect(((await (await fetch(t.url('/games'))).json()) as { items: { id: number }[] }).items.some((g) => g.id === other.id)).toBe(false);
    expect((await admin.call('PATCH', '/admin/games/32000', { active: false })).status).toBe(404);
    const opId = await fx.staff('operator');
    expect(
      (
        await call(fx.headers(await fx.session({ staffId: opId }), opId, 'staff'))('POST', '/admin/games', {
          slug: 'x-y',
          name: 'X',
          platforms: ['pc'],
          codePlacement: 'bio',
          publisherNote: 'No transfers at all.',
        })
      ).status,
    ).toBe(403);
    expect(await fx.query(`SELECT action FROM audit.events WHERE actor_id = $1 AND action LIKE 'games.catalogue.%' ORDER BY id`, [admin.staffId])).toEqual([
      { action: 'games.catalogue.added' },
      { action: 'games.catalogue.added' },
      { action: 'games.catalogue.updated' },
    ]);
  });

  it('FR-GAM-02 the seller adds the game, platform, player ID and contents to their own game-account listing', async () => {
    const seller = await member();
    const listingId = await gameListing(seller.userId);
    const r = await seller.call('PUT', `/listings/${listingId}/game-details`, details());
    expect([r.status, await r.json()]).toEqual([
      200,
      { listingId, gameId: game.id, platform: 'android', playerId: '5123 4567', contents: 'Level 70, three mythic skins, no linked purchases.' },
    ]);
    expect(await fx.query(`SELECT player_id_norm FROM game_accounts.details WHERE listing_id = $1`, [listingId])).toEqual([{ player_id_norm: '51234567' }]);
    expect(await (await seller.call('PUT', `/listings/${listingId}/game-details`, details({ platform: 'ios' }))).json()).toMatchObject({ platform: 'ios' }); // editable before a proof
    expect(await errors(await seller.call('PUT', `/listings/${listingId}/game-details`, details({ platform: 'pc' })))).toEqual([
      { field: 'platform', reason: 'not-offered' },
    ]);
    expect(await errors(await seller.call('PUT', `/listings/${listingId}/game-details`, details({ gameId: 32000 })))).toEqual([
      { field: 'gameId', reason: 'unknown' },
    ]);
    expect((await (await member()).call('PUT', `/listings/${listingId}/game-details`, details())).status).toBe(404); // not theirs
    expect((await seller.call('PUT', `/listings/${await gameListing(seller.userId, 'physical')}/game-details`, details())).status).toBe(404);
    expect((await seller.call('PUT', `/listings/${listingId}/game-details`, details({ contents: 'short' }))).status).toBe(400);
  });

  it('FR-GAM-03 the seller gets a code valid 7 days, uploads a screenshot showing it; the proof goes to review and the details are fixed', async () => {
    const seller = await member();
    const listingId = await gameListing(seller.userId);
    expect(await errors(await seller.call('POST', `/listings/${listingId}/ownership-code`))).toEqual([{ field: 'listing', reason: 'game-details-missing' }]);
    await seller.call('PUT', `/listings/${listingId}/game-details`, details());
    expect(await errors(await seller.upload(`/listings/${listingId}/ownership-proof`, await png()))).toEqual([
      { field: 'listing', reason: 'not-submitted-for-review' },
    ]); // a draft
    await hold(listingId);
    expect(await errors(await seller.upload(`/listings/${listingId}/ownership-proof`, await png()))).toEqual([{ field: 'listing', reason: 'no-code' }]);
    const first = (await (await seller.call('POST', `/listings/${listingId}/ownership-code`)).json()) as { code: string; expiresAt: string; placement: string };
    expect(first.code).toMatch(/^TB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(Math.round((Date.parse(first.expiresAt) - Date.now()) / 86_400_000)).toBe(7); // DV-33
    expect(first.placement).toBe('the profile signature');
    const second = (await (await seller.call('POST', `/listings/${listingId}/ownership-code`)).json()) as { code: string };
    expect(second.code).not.toBe(first.code);
    expect(await fx.query(`SELECT code, status FROM game_accounts.ownership_proofs WHERE listing_id = $1 ORDER BY issued_at, status`, [listingId])).toEqual(
      expect.arrayContaining([
        { code: first.code, status: 'expired' },
        { code: second.code, status: 'issued' },
      ]),
    );

    expect((await seller.upload(`/listings/${listingId}/ownership-proof`, Buffer.from('%PDF-1.4'), 'application/pdf')).status).toBe(400);
    const r = await seller.upload(`/listings/${listingId}/ownership-proof`, await png());
    expect([r.status, ((await r.json()) as { status: string }).status]).toEqual([201, 'submitted']);
    const [p] = await fx.query<{ status: string; key: string }>(`SELECT status, screenshot_key AS key FROM game_accounts.ownership_proofs WHERE code = $1`, [
      second.code,
    ]);
    expect(p.status).toBe('submitted');
    expect(p.key).toMatch(/^v1\.ownership_proof\./); // encrypted by Unit 1's FileVault
    expect(await errors(await seller.call('PUT', `/listings/${listingId}/game-details`, details({ playerId: '99999999' })))).toEqual([
      { field: 'playerId', reason: 'fixed-after-proof' },
    ]);
    expect(await errors(await seller.call('POST', `/listings/${listingId}/ownership-code`))).toEqual([{ field: 'listing', reason: 'proof-under-review' }]);
    expect(await (await seller.call('GET', `/listings/${listingId}/ownership`)).json()).toMatchObject({
      details: { playerId: '5123 4567' },
      proof: { code: second.code, status: 'submitted', submittedAt: expect.any(String), reason: null },
    });
    expect((await (await member()).call('GET', `/listings/${listingId}/ownership`)).status).toBe(404);
  });

  it('FR-GAM-03 DV-33 an expired code is refused; the seller asks for a new one', async () => {
    const seller = await member();
    const listingId = await gameListing(seller.userId);
    await seller.call('PUT', `/listings/${listingId}/game-details`, details({ playerId: `p${randomInt(1e6, 9e6)}` }));
    await hold(listingId);
    await fx.query(
      `INSERT INTO game_accounts.ownership_proofs (listing_id, code, issued_at, expires_at) VALUES ($1, $2, now() - interval '8 days', now() - interval '1 day')`,
      [listingId, `TB-${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`],
    );
    expect(await errors(await seller.upload(`/listings/${listingId}/ownership-proof`, await png()))).toEqual([{ field: 'code', reason: 'code-expired' }]);
    expect(((await (await seller.call('GET', `/listings/${listingId}/ownership`)).json()) as { proof: { status: string } }).proof.status).toBe('expired');
    expect((await seller.call('POST', `/listings/${listingId}/ownership-code`)).status).toBe(201);
  });
});
