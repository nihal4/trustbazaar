import { randomInt, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { seedAreas } from '../../src/areas-seed';
import { DELIVERY_PORT, DeliveryPort } from '../../src/modules/delivery/ports';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U4-02: drop-off areas, the fulfilment options and indicative fee, saved addresses (encrypted), binding quotes and
// their one claim by Unit 2, and the administrator's areas and fare tables (docs/design/04_delivery.pdf sections 3,
// 5 and 7.1). Amounts in poisha; the seeded fare table (version 1) is RedX's published rates.

describe('delivery areas, addresses and quotes', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;
  let area: (district: string, nameEn: string) => Promise<number>;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    await seedAreas(t.app.get(DataSource));
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`,
      [`dlv-${randomUUID().slice(0, 8)}`],
    );
    area = async (district, nameEn) =>
      (await fx.query<{ id: number }>(`SELECT id FROM delivery.areas WHERE district = $1 AND name_en = $2`, [district, nameEn]))[0].id;
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member(o: { kyc?: string } = {}) {
    const userId = await fx.user(o);
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method, headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const json = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, status = 200) => {
      const r = await call(method, path, body);
      expect({ path, status: r.status }).toEqual({ path, status });
      return (await r.json()) as T;
    };
    return { userId, call, json };
  }
  async function admin(role: 'administrator' | 'operator' = 'administrator') {
    const staffId = await fx.staff(role);
    const sid = await fx.session({ staffId });
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), { method, headers: { ...fx.headers(sid, staffId, 'staff'), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { staffId, call };
  }
  /** An active listing in Dhanmondi (the design's worked example), a phone up to 1 kg, small. */
  async function listing(sellerId: string, o: { options?: string; weight?: string; size?: string; district?: string; lat?: number; lng?: number; quantity?: number } = {}) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Phone for the delivery tests', 'A phone in good condition, written by the delivery tests.', 'used', true,
          $3, $4, $5, $6, $7, $8, 1500000, $9, $9) RETURNING id`,
      [sellerId, category, o.options ?? 'pickup_or_courier', o.weight ?? 'up_to_1kg', o.size ?? 'small', o.district ?? 'Dhaka', o.lat ?? 23.746, o.lng ?? 90.376, o.quantity ?? 5],
    );
    for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    return id;
  }
  const dropoff = (u: Awaited<ReturnType<typeof member>>, areaId: number, kind = 'dropoff') =>
    u.json<{ id: string }>('POST', '/me/addresses', { kind, label: 'Home', areaId, line1: 'House 12, Road 5', landmark: 'Near the mosque', contactName: 'Rahim Uddin' }, 201);

  it('FR-DLV-08 the drop-off areas are public, in both languages, by district; the starter list loads once', async () => {
    expect(await seedAreas(t.app.get(DataSource))).toBe(0); // already there: nothing changes
    const r = await fetch(t.url('/delivery/areas'));
    expect(r.status).toBe(200);
    const { items } = (await r.json()) as { items: { district: string; nameEn: string; nameBn: string; zone: string }[] };
    expect(items.find((a) => a.nameEn === 'Savar')).toMatchObject({ district: 'Dhaka', nameBn: 'সাভার', zone: 'dhaka_suburbs' });
    expect(items.find((a) => a.nameEn === 'Dhanmondi')).toMatchObject({ zone: 'inside_dhaka' });
    expect(items.find((a) => a.district === 'Chattogram')).toMatchObject({ zone: 'outside_dhaka' });
  });

  it('FR-DLV-01 FR-DLV-02 the options give the distance in whole km, the recommendation and an indicative fee', async () => {
    const seller = await member();
    const buyer = await member();
    const phone = await listing(seller.userId);
    const savar = await buyer.json<Record<string, unknown>>('GET', `/listings/${phone}/fulfilment-options?areaId=${await area('Dhaka', 'Savar')}`);
    // the design's worked example: Dhanmondi (inside Dhaka) to Savar (suburbs) is the suburbs zone, 1 kg: BDT 80
    expect(savar).toMatchObject({ methods: ['self_pickup', 'courier'], recommended: 'courier', courier: { available: true, fee: '8000', billedKg: 1, zone: 'dhaka_suburbs' } });
    expect(savar.distanceKm).toBeGreaterThan(10);
    const near = await buyer.json('GET', `/listings/${phone}/fulfilment-options?areaId=${await area('Dhaka', 'Dhanmondi')}`);
    expect(near).toMatchObject({ distanceKm: 0, recommended: 'self_pickup', courier: { fee: '5000', zone: 'inside_dhaka' } });

    // a large item up to 2 kg sent outside Dhaka is billed at 5 kg: 120 + 3 x 20 = BDT 180
    const large = await listing(seller.userId, { weight: 'up_to_2kg', size: 'large' });
    expect(await buyer.json('GET', `/listings/${large}/fulfilment-options?areaId=${await area('Chattogram', 'Chattogram Sadar')}`))
      .toMatchObject({ courier: { available: true, fee: '18000', billedKg: 5, zone: 'outside_dhaka' } });
    // 3 units of 5 kg exceed DV-24 (10 kg): courier is not offered for that quantity
    expect(await buyer.json('GET', `/listings/${large}/fulfilment-options?areaId=${await area('Dhaka', 'Savar')}&quantity=3`))
      .toMatchObject({ recommended: 'self_pickup', courier: { available: false, reason: 'parcel_too_large' } });
    const pickupOnly = await listing(seller.userId, { options: 'pickup_only', weight: 'up_to_1kg' });
    expect(await buyer.json('GET', `/listings/${pickupOnly}/fulfilment-options?areaId=${await area('Dhaka', 'Savar')}`))
      .toMatchObject({ methods: ['self_pickup'], recommended: 'self_pickup', courier: { available: false, reason: 'courier_not_offered' } });

    expect((await seller.call('GET', `/listings/${phone}/fulfilment-options?areaId=${await area('Dhaka', 'Savar')}`)).status).toBe(403); // own listing
    const unverified = await member({ kyc: 'unsubmitted' });
    expect((await unverified.call('GET', `/listings/${phone}/fulfilment-options?areaId=1`)).status).toBe(403);
    expect((await buyer.call('GET', `/listings/${phone}/fulfilment-options?areaId=99999999`)).status).toBe(400);
  });

  it('FR-DLV-07 saved addresses are encrypted at rest, shown only to their owner, and erased when deleted', async () => {
    const u = await member();
    const other = await member();
    const savar = await area('Dhaka', 'Savar');
    const a = await dropoff(u, savar);
    const [row] = await fx.query<{ address_enc: Buffer; label: string }>(`SELECT address_enc, label FROM delivery.saved_addresses WHERE id = $1`, [a.id]);
    expect(row.label).toBe('Home');
    expect(row.address_enc.toString('latin1')).not.toMatch(/Road 5|Rahim|mosque/);
    expect((await u.json<{ items: unknown[] }>('GET', '/me/addresses')).items).toEqual([
      expect.objectContaining({ id: a.id, kind: 'dropoff', line1: 'House 12, Road 5', landmark: 'Near the mosque', contactName: 'Rahim Uddin', area: expect.objectContaining({ nameEn: 'Savar' }) }),
    ]);
    expect((await other.json<{ items: unknown[] }>('GET', '/me/addresses')).items).toEqual([]);
    expect((await other.call('DELETE', `/me/addresses/${a.id}`)).status).toBe(404);
    // the ciphertext is bound to its row: copied into another row it does not decrypt
    const b = await dropoff(u, savar);
    await fx.query(`UPDATE delivery.saved_addresses SET address_enc = $2 WHERE id = $1`, [b.id, row.address_enc]);
    expect((await u.call('GET', '/me/addresses')).status).toBe(500);
    await fx.query(`UPDATE delivery.saved_addresses SET deleted_at = now(), address_enc = NULL WHERE id = $1`, [b.id]);

    expect((await u.call('DELETE', `/me/addresses/${a.id}`)).status).toBe(204);
    expect(await fx.query(`SELECT address_enc FROM delivery.saved_addresses WHERE id = $1`, [a.id])).toEqual([{ address_enc: null }]);
    expect((await u.json<{ items: unknown[] }>('GET', '/me/addresses')).items).toEqual([]);
    expect((await u.call('POST', '/me/addresses', { kind: 'dropoff', label: ' ', areaId: savar, line1: '', contactName: 'R' })).status).toBe(400);
  });

  it('FR-DLV-08 FR-DLV-09 a binding quote to the buyer\'s own drop-off address, claimed once by the buyer\'s order', async () => {
    const seller = await member();
    const buyer = await member();
    const phone = await listing(seller.userId);
    const home = await dropoff(buyer, await area('Dhaka', 'Savar'));
    const q = await buyer.json<{ id: string; fee: string; expiresAt: string; fareVersion: number; zone: string }>('POST', '/delivery/quotes', { listingId: phone, quantity: 2, addressId: home.id }, 201);
    expect(q).toMatchObject({ fee: '9500', zone: 'dhaka_suburbs' }); // 2 kg in the suburbs zone: BDT 95
    expect(Date.parse(q.expiresAt) - Date.now()).toBeGreaterThan(29 * 60_000); // DV-23

    const pickupAddr = await dropoff(buyer, await area('Dhaka', 'Savar'), 'pickup');
    expect((await buyer.call('POST', '/delivery/quotes', { listingId: phone, quantity: 1, addressId: pickupAddr.id })).status).toBe(400);
    const stranger = await member();
    expect((await stranger.call('POST', '/delivery/quotes', { listingId: phone, quantity: 1, addressId: home.id })).status).toBe(400); // not theirs
    const refused = await buyer.call('POST', '/delivery/quotes', { listingId: await listing(seller.userId, { options: 'pickup_only' }), quantity: 1, addressId: home.id });
    expect(refused.status).toBe(422);
    expect((await refused.json()).errors).toEqual([{ field: 'fulfilment', reason: 'courier_not_offered' }]);
    const heavy = await buyer.call('POST', '/delivery/quotes', { listingId: await listing(seller.userId, { weight: 'up_to_5kg' }), quantity: 3, addressId: home.id });
    expect((await heavy.json()).errors).toEqual([{ field: 'quantity', reason: 'parcel_too_large' }]);

    // checkout still refuses courier until shipments exist (U4-04); the claim is Unit 2's, in its transaction
    expect((await (await buyer.call('POST', '/orders', { listingId: phone, quantity: 2, fulfilment: 'courier', quoteId: q.id })).json()).errors)
      .toEqual([{ field: 'fulfilment', reason: 'courier-not-yet-available' }]);
    const order = await buyer.json<{ id: string }>('POST', '/orders', { listingId: phone, quantity: 2, fulfilment: 'self_pickup' }, 201);
    const port = t.app.get<DeliveryPort>(DELIVERY_PORT);
    expect(port.shipsCourier).toBe(false);
    const ds = t.app.get(DataSource);
    const claim = (o: Partial<{ buyerId: string; quantity: number }> = {}) =>
      ds.transaction((m) => port.claimQuote({ quoteId: q.id, orderId: order.id, buyerId: o.buyerId ?? buyer.userId, listingId: phone, quantity: o.quantity ?? 2 }, m));
    await expect(claim({ quantity: 1 })).rejects.toMatchObject({ problem: 'delivery-refused', extra: { errors: [{ field: 'quoteId', reason: 'quote_mismatch' }] } });
    await expect(claim({ buyerId: stranger.userId })).rejects.toMatchObject({ extra: { errors: [{ field: 'quoteId', reason: 'quote_mismatch' }] } });
    expect(await claim()).toBe(9500n);
    await expect(claim()).rejects.toMatchObject({ extra: { errors: [{ field: 'quoteId', reason: 'quote_used' }] } });
  });

  it('CP-43 FR-OPS-08 administrators maintain areas and publish fare-table versions; quotes record the version they used', async () => {
    const adm = await admin();
    const op = await admin('operator');
    const added = await adm.call('POST', '/admin/areas', { district: 'Sylhet', nameEn: `Zindabazar ${randomInt(1, 1e6)}`, nameBn: 'জিন্দাবাজার', zone: 'outside_dhaka', lat: 24.89512, lng: 91.86811 });
    expect(added.status).toBe(201);
    const a = (await added.json()) as { id: number; lat: number };
    expect(a.lat).toBe(24.895); // rounded to 3 decimals
    expect((await op.call('POST', '/admin/areas', { district: 'Sylhet', nameEn: 'X', nameBn: 'এক্স', zone: 'outside_dhaka', lat: 24.9, lng: 91.9 })).status).toBe(403);
    expect((await adm.call('POST', '/admin/areas', { district: 'Sylhet', nameEn: 'Abroad', nameBn: 'বিদেশ', zone: 'outside_dhaka', lat: 40, lng: 91.9 })).status).toBe(400);
    const patched = await adm.call('PATCH', `/admin/areas/${a.id}`, { active: false });
    expect(await patched.json()).toMatchObject({ id: a.id, active: false });
    const listed = (await (await fetch(t.url('/delivery/areas'))).json()) as { items: { id: number }[] };
    expect(listed.items.some((x) => x.id === a.id)).toBe(false); // inactive areas are not offered

    const current = (await (await adm.call('GET', '/admin/fare-tables/current')).json()) as { version: number; rows: { zone: string; upTo1kg: string }[] };
    expect(current.rows.find((r) => r.zone === 'dhaka_suburbs')?.upTo1kg).toBe('8000');
    const same = current.rows.map(({ zone, upTo1kg, ...r }) => ({ zone, upTo1kg, upTo2kg: (r as { upTo2kg: string }).upTo2kg, perExtraKg: (r as { perExtraKg: string }).perExtraKg }));
    expect((await adm.call('POST', '/admin/fare-tables', { source: 'too short', rows: same })).status).toBe(400);
    expect((await adm.call('POST', '/admin/fare-tables', { source: 'RedX merchant rates, reviewed', rows: same.slice(0, 2) })).status).toBe(400);
    const rising = same.map((r) => (r.zone === 'inside_dhaka' ? { ...r, upTo2kg: '100' } : r));
    expect((await adm.call('POST', '/admin/fare-tables', { source: 'RedX merchant rates, reviewed', rows: rising })).status).toBe(400); // fare never falls with weight
    const published = await adm.call('POST', '/admin/fare-tables', { source: 'RedX merchant rates, reviewed by the administrator', rows: same });
    expect(published.status).toBe(201);
    const v = ((await published.json()) as { version: number }).version;
    expect(v).toBeGreaterThan(current.version);
    expect(await fx.query(`SELECT 1 FROM audit.events WHERE action = 'delivery.fare_table.published' AND actor_id = $1`, [adm.staffId])).toHaveLength(1);

    const seller = await member();
    const buyer = await member();
    const home = await dropoff(buyer, await area('Dhaka', 'Savar'));
    const q = await buyer.json<{ fareVersion: number }>('POST', '/delivery/quotes', { listingId: await listing(seller.userId), quantity: 1, addressId: home.id }, 201);
    expect(q.fareVersion).toBe(v);
  });
});
