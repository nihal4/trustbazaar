import { QueryFailedError } from 'typeorm';
import { Problem } from '../../../kernel/http/problems';
import { DeliveryAdminController } from '../http/delivery-admin.controller';
import { DeliveryController } from '../http/delivery.controller';
import { AddressService, contextOf } from './address.service';
import { AreasService } from './areas.service';
import { FareTableService } from './fare-table.service';
import { QuoteService } from './quote.service';
import { fromDeliveryDb, refusal } from './refusals';

// U4-02 with the database faked: what each service asks of it and how it answers (the rules themselves are the
// database's, tested in docs/design/sql/04_delivery_tests.sql and test/api/delivery-quotes.spec.ts).

type Answer = (sql: string, params: unknown[]) => unknown;
function fakeDb(answer: Answer) {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => answer(sql, params));
  const manager = { query };
  return { query, manager, transaction: async <T>(fn: (m: typeof manager) => Promise<T>) => fn(manager) };
}
const dbError = (message: string, code = '23514') => new QueryFailedError('q', [], Object.assign(new Error(message), { code, message }));
const problemOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof Problem) return [e.problem, ...((e.extra.errors as { field: string; reason: string }[] | undefined) ?? []).map((x) => `${x.field}:${x.reason}`)];
    throw e;
  }
  return null;
};
const audit = () => ({ record: jest.fn(async () => undefined) });
const AREA = { id: 4, district: 'Dhaka', name_en: 'Savar', name_bn: 'সাভার', zone: 'dhaka_suburbs', lat: '23.858', lng: '90.267', active: true };

describe('delivery refusals', () => {
  it('FR-DLV-08 the database\'s refusals become the stable codes of section 3.1', () => {
    const codes = [
      ['the seller does not offer courier for this listing', 'fulfilment:courier_not_offered'],
      ['parcel too heavy or too large for courier', 'quantity:parcel_too_large'],
      ['quote does not match this order', 'quoteId:quote_mismatch'],
      ['quote already used', 'quoteId:quote_used'],
      ['duplicate key value violates unique constraint "quote_one_per_order"', 'quoteId:quote_used'],
      ['quote expired', 'quoteId:quote_expired'],
    ];
    for (const [message, code] of codes) {
      try {
        fromDeliveryDb(dbError(message));
      } catch (e) {
        expect(e).toBeInstanceOf(Problem);
        const p = e as Problem;
        expect([p.problem, `${(p.extra.errors as { field: string }[])[0].field}:${(p.extra.errors as { reason: string }[])[0].reason}`]).toEqual(['delivery-refused', code]);
      }
    }
    expect(() => fromDeliveryDb(new Error('other'))).toThrow('other');
    expect(refusal('x', 'y').extra).toEqual({ errors: [{ field: 'x', reason: 'y' }] });
  });
});

describe('AreasService', () => {
  it('FR-DLV-08 lists active areas; administrators add and change them, audited', async () => {
    const db = fakeDb((sql) => (sql.includes('FOR UPDATE') || sql.startsWith('SELECT') || sql.includes('RETURNING') ? [AREA] : []));
    const a = audit();
    const svc = new AreasService(db as never, a as never);
    expect((await svc.list()).items[0]).toEqual({ id: 4, district: 'Dhaka', nameEn: 'Savar', nameBn: 'সাভার', zone: 'dhaka_suburbs', lat: 23.858, lng: 90.267, active: true });
    expect(await svc.get(4)).toMatchObject({ nameEn: 'Savar' });
    expect(await svc.create('S1', { district: ' Dhaka ', nameEn: 'Savar', nameBn: 'সাভার', zone: 'dhaka_suburbs', lat: 23.8581, lng: 90.2672 })).toMatchObject({ id: 4 });
    expect(db.query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT'))?.[1]).toEqual(['Dhaka', 'Savar', 'সাভার', 'dhaka_suburbs', 23.8581, 90.2672, true]);
    expect(await svc.update('S1', 4, { active: false })).toMatchObject({ id: 4 });
    expect(a.record.mock.calls.map((c) => (c as unknown as [{ action: string }])[0].action)).toEqual(['delivery.area.added', 'delivery.area.changed']);
  });

  it('FR-DLV-08 an unknown area, a duplicate name and a centroid outside Bangladesh are refused', async () => {
    const none = new AreasService(fakeDb(() => []) as never, audit() as never);
    expect(await none.get(9)).toBeNull();
    expect(await problemOf(none.update('S1', 9, { active: false }))).toEqual(['not-found']);
    const dup = new AreasService(fakeDb(() => { throw dbError('dup', '23505'); }) as never, audit() as never);
    expect(await problemOf(dup.create('S1', { district: 'Dhaka', nameEn: 'Savar', nameBn: 'স', zone: 'dhaka_suburbs', lat: 23, lng: 90 }))).toEqual(['validation-failed', 'nameEn:exists-in-district']);
    const out = new AreasService(fakeDb(() => { throw dbError('check', '23514'); }) as never, audit() as never);
    expect(await problemOf(out.create('S1', { district: 'X', nameEn: 'Y', nameBn: 'Z', zone: 'outside_dhaka', lat: 40, lng: 90 }))).toEqual(['validation-failed', 'lat:outside-bangladesh']);
  });
});

describe('FareTableService', () => {
  const rows = [
    { zone: 'inside_dhaka' as const, upTo1kg: '5000', upTo2kg: '6500', perExtraKg: '1500' },
    { zone: 'dhaka_suburbs' as const, upTo1kg: '8000', upTo2kg: '9500', perExtraKg: '1500' },
    { zone: 'outside_dhaka' as const, upTo1kg: '10000', upTo2kg: '12000', perExtraKg: '2000' },
  ];
  const T = { version: 2, effective_from: new Date('2026-11-02T00:00:00Z'), source: 'RedX merchant rates' };
  const answer: Answer = (sql) => {
    if (sql.includes('max(version)')) return [{ v: 2 }];
    if (sql.includes('INSERT INTO delivery.fare_tables') || sql.includes('fare_version_at')) return [T];
    if (sql.includes('FROM delivery.fare_rows')) return rows.map((r) => ({ zone: r.zone, up_to_1kg: r.upTo1kg, up_to_2kg: r.upTo2kg, per_extra_kg: r.perExtraKg }));
    return [];
  };

  it('CP-43 FR-OPS-08 a new version has all three zones, a source and an author, and is audited', async () => {
    const db = fakeDb(answer);
    const a = audit();
    const svc = new FareTableService(db as never, a as never);
    expect(await svc.current()).toMatchObject({ version: 2, rows });
    expect(await svc.publish('S1', { source: '  RedX merchant rates  ', rows })).toMatchObject({ version: 2, source: 'RedX merchant rates', rows });
    expect(db.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO delivery.fare_rows'))).toHaveLength(3);
    expect(a.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'delivery.fare_table.published', actorId: 'S1' }), db.manager);
  });

  it('CP-43 incomplete tables, short sources, past dates and falling fares are refused', async () => {
    const svc = new FareTableService(fakeDb(answer) as never, audit() as never);
    expect(await problemOf(svc.publish('S1', { source: 'RedX merchant rates', rows: rows.slice(0, 2) }))).toEqual(['validation-failed', 'rows:one-per-zone']);
    expect(await problemOf(svc.publish('S1', { source: 'short', rows }))).toEqual(['validation-failed', 'source:too-short']);
    expect(await problemOf(svc.publish('S1', { source: 'RedX merchant rates', rows, effectiveFrom: '2020-01-01T00:00:00Z' }))).toEqual(['validation-failed', 'effectiveFrom:not-in-the-past']);
    const falling = new FareTableService(fakeDb((sql) => { if (sql.includes('fare_rows (')) throw dbError('fare_rises_with_weight'); return answer(sql, []); }) as never, audit() as never);
    expect(await problemOf(falling.publish('S1', { source: 'RedX merchant rates', rows }))).toEqual(['validation-failed', 'rows:fare-must-rise-with-weight']);
    expect(await new FareTableService(fakeDb(() => []) as never, audit() as never).current()).toBeNull();
  });
});

describe('AddressService', () => {
  const crypto = {
    encrypt: jest.fn(async (plain: string, ctx: string) => new Uint8Array(Buffer.from(`${ctx}|${plain}`))),
    decrypt: jest.fn(async (sealed: Uint8Array, ctx: string) => {
      const [c, plain] = Buffer.from(sealed).toString().split(/\|(.*)/s);
      if (c !== ctx) throw new Error('bad tag');
      return plain;
    }),
  };

  it('FR-DLV-07 the lines are encrypted under the row\'s own context, shown to the owner only, and erased on delete', async () => {
    const stored: Record<string, unknown>[] = [];
    const db = fakeDb((sql, p) => {
      if (sql.includes('FROM delivery.areas')) return [{ id: 4, district: 'Dhaka', name_en: 'Savar', name_bn: 'সাভার' }];
      if (sql.startsWith('INSERT')) {
        stored.push({ id: p[0], kind: p[2], label: p[3], address_enc: p[5], created_at: new Date('2026-11-02T00:00:00Z'), area_id: 4, district: 'Dhaka', name_en: 'Savar', name_bn: 'সাভার' });
        return [{ created_at: new Date('2026-11-02T00:00:00Z') }];
      }
      if (sql.includes('FROM delivery.saved_addresses s')) return stored;
      if (sql.startsWith('UPDATE')) return [[{ id: p[0] }], 1];
      return [];
    });
    const svc = new AddressService(db as never, crypto as never);
    const a = await svc.create('U1', { kind: 'dropoff', label: '  Home ', areaId: 4, line1: ' House 12,  Road 5 ', contactName: 'Rahim', landmark: '' });
    expect(a).toMatchObject({ kind: 'dropoff', label: 'Home', line1: 'House 12, Road 5', contactName: 'Rahim', area: { nameEn: 'Savar' } });
    expect(a).not.toHaveProperty('landmark');
    expect(crypto.encrypt).toHaveBeenCalledWith(JSON.stringify({ line1: 'House 12, Road 5', contactName: 'Rahim' }), contextOf(a.id));
    expect((await svc.list('U1')).items).toEqual([expect.objectContaining({ id: a.id, line1: 'House 12, Road 5', contactName: 'Rahim' })]);
    await svc.remove('U1', a.id);
    const none = new AddressService(fakeDb((sql) => (sql.startsWith('UPDATE') ? [[], 0] : [])) as never, crypto as never);
    expect(await problemOf(none.remove('U1', a.id))).toEqual(['not-found']);
  });

  it('FR-DLV-07 missing and over-long fields and an unknown area are refused', async () => {
    const svc = new AddressService(fakeDb(() => []) as never, crypto as never);
    expect(await problemOf(svc.create('U1', { kind: 'dropoff', label: ' ', areaId: 4, line1: '', contactName: '' })))
      .toEqual(['validation-failed', 'label:required', 'line1:required', 'contactName:required']);
    expect(await problemOf(svc.create('U1', { kind: 'dropoff', label: 'x'.repeat(41), areaId: 4, line1: 'y'.repeat(121), contactName: 'R' })))
      .toEqual(['validation-failed', 'label:too-long', 'line1:too-long']);
    expect(await problemOf(svc.create('U1', { kind: 'dropoff', label: 'Home', areaId: 99, line1: 'Road 1', contactName: 'R' }))).toEqual(['validation-failed', 'areaId:unknown']);
  });
});

describe('QuoteService', () => {
  const facts = { options: ['self_pickup', 'courier'], weightClass: 'up_to_1kg', sizeClass: 'small', district: 'Dhaka', approxLat: 23.746, approxLng: 90.376 };
  const listings = (o: { status?: string; sellerId?: string; options?: string[] } = {}) => ({
    threadFacts: jest.fn(async () => ({ sellerId: o.sellerId ?? 'S', title: 'Phone', status: o.status ?? 'active' })),
    fulfilmentFacts: jest.fn(async () => ({ ...facts, options: o.options ?? facts.options })),
  });
  const params = { current: async () => ({ get: () => 2 }) };
  const closed = { isOpen: async () => false };
  const OPTIONS = { distance: 14.2, recommended: 'courier', kg: 1, version: 1, zone: 'dhaka_suburbs', fee: '8000' };

  it('FR-DLV-01 FR-DLV-02 options: whole km, the recommendation, and an indicative fee or why not', async () => {
    const db = fakeDb(() => [OPTIONS]);
    const svc = new QuoteService(db as never, closed as never, listings() as never, params as never);
    expect(await svc.options('B', 'L1', 4, 1)).toEqual({
      listingId: 'L1', areaId: 4, quantity: 1, methods: ['self_pickup', 'courier'], distanceKm: 14, recommended: 'courier',
      courier: { available: true, fee: '8000', billedKg: 1, zone: 'dhaka_suburbs', fareVersion: 1 },
    });
    expect(db.query.mock.calls[0][1]).toEqual([4, 23.746, 90.376, 'pickup_or_courier', 'up_to_1kg', 'small', 1, 10, 2, 'Dhaka']);
    const heavy = new QuoteService(fakeDb(() => [{ ...OPTIONS, kg: null, fee: null }]) as never, closed as never, listings() as never, params as never);
    expect(await heavy.options('B', 'L1', 4, 3)).toMatchObject({ recommended: 'self_pickup', courier: { available: false, reason: 'parcel_too_large' } });
    const pickup = new QuoteService(fakeDb(() => [{ ...OPTIONS, recommended: 'self_pickup' }]) as never, closed as never, listings({ options: ['self_pickup'] }) as never, params as never);
    expect(await pickup.options('B', 'L1', 4, 1)).toMatchObject({ courier: { available: false, reason: 'courier_not_offered' } });
    const courierOnly = new QuoteService(fakeDb(() => [OPTIONS]) as never, closed as never, listings({ options: ['courier'] }) as never, params as never);
    await courierOnly.options('B', 'L1', 4, 1);
    expect(await problemOf(new QuoteService(fakeDb(() => []) as never, closed as never, listings() as never, params as never).options('B', 'L1', 99, 1))).toEqual(['validation-failed', 'areaId:unknown']);
    expect(await problemOf(svc.options('S', 'L1', 4, 1))).toEqual(['forbidden', 'listingId:own-listing']);
    expect(await problemOf(new QuoteService(db as never, closed as never, listings({ status: 'sold' }) as never, params as never).options('B', 'L1', 4, 1))).toEqual(['not-found']);
  });

  it('FR-DLV-08 a quote is issued to the buyer\'s own drop-off address; DV-23 validity; refusals by code', async () => {
    const quoteRow = { id: 'Q1', listing_id: 'L1', quantity: 2, dropoff_address_id: 'A1', to_area_id: 4, zone: 'dhaka_suburbs', billed_kg: 2, distance_km: 14.2, fee: '9500', fare_version: 1, expires_at: new Date('2026-11-02T00:30:00Z') };
    const db = fakeDb((sql) => (sql.includes('saved_addresses') ? [{ area_id: 4 }] : sql.includes('make_quote') ? [quoteRow] : []));
    const svc = new QuoteService(db as never, closed as never, listings() as never, params as never);
    expect(await svc.issue('B', { listingId: 'L1', quantity: 2, addressId: 'A1' })).toEqual({
      id: 'Q1', listingId: 'L1', quantity: 2, addressId: 'A1', areaId: 4, zone: 'dhaka_suburbs', billedKg: 2, distanceKm: 14, fee: '9500', fareVersion: 1,
      expiresAt: '2026-11-02T00:30:00.000Z',
    });
    expect(db.query.mock.calls.find(([sql]) => String(sql).includes('make_quote'))?.[1]).toContain('30 minutes');
    expect(await problemOf(new QuoteService(fakeDb(() => []) as never, closed as never, listings() as never, params as never).issue('B', { listingId: 'L1', quantity: 1, addressId: 'A9' })))
      .toEqual(['validation-failed', 'addressId:not-a-dropoff-address-of-yours']);
    expect(await problemOf(new QuoteService(db as never, closed as never, listings({ options: ['self_pickup'] }) as never, params as never).issue('B', { listingId: 'L1', quantity: 1, addressId: 'A1' })))
      .toEqual(['delivery-refused', 'fulfilment:courier_not_offered']);
    const tooBig = new QuoteService(fakeDb((sql) => { if (sql.includes('make_quote')) throw dbError('parcel too heavy or too large for courier'); return [{ area_id: 4 }]; }) as never, closed as never, listings() as never, params as never);
    expect(await problemOf(tooBig.issue('B', { listingId: 'L1', quantity: 9, addressId: 'A1' }))).toEqual(['delivery-refused', 'quantity:parcel_too_large']);
  });

  it('NFR-REL-04 while the courier circuit breaker is open, new courier quotes are refused 503 courier-unavailable', async () => {
    const db = fakeDb((sql) => (sql.includes('saved_addresses') ? [{ area_id: 4 }] : []));
    const svc = new QuoteService(db as never, { isOpen: async () => true } as never, listings() as never, params as never);
    expect(await problemOf(svc.issue('B', { listingId: 'L1', quantity: 1, addressId: 'A1' }))).toEqual(['courier-unavailable', 'fulfilment:courier_unavailable']);
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('make_quote'))).toBe(false);
  });

  it('I-21 claimQuote runs in the caller\'s transaction and returns the fee', async () => {
    const svc = new QuoteService(fakeDb(() => []) as never, closed as never, listings() as never, params as never);
    const tx = { query: jest.fn(async () => [{ fee: '9500' }]) };
    expect(await svc.claimQuote({ quoteId: 'Q1', orderId: 'O1', buyerId: 'B', listingId: 'L1', quantity: 2 }, tx as never)).toBe(9500n);
    expect(tx.query).toHaveBeenCalledWith(expect.stringContaining('delivery.claim_quote'), ['Q1', 'O1', 'B', 'L1', 2]);
    const used = { query: jest.fn(async () => { throw dbError('quote already used'); }) };
    expect(await problemOf(svc.claimQuote({ quoteId: 'Q1', orderId: 'O2', buyerId: 'B', listingId: 'L1', quantity: 2 }, used as never))).toEqual(['delivery-refused', 'quoteId:quote_used']);
  });
});

describe('Delivery controllers', () => {
  const user = { type: 'user', userId: 'U1', sessionId: 's', accountStatus: 'active', kycStatus: 'verified', emailVerified: true } as const;
  const staff = { type: 'staff', staffId: 'S1', sessionId: 's', role: 'administrator' } as const;

  it('IF-UI-05 each route hands its caller and input to its service; the other kind of principal is refused', async () => {
    const areas = { list: jest.fn(), create: jest.fn(), update: jest.fn() };
    const quotes = { options: jest.fn(), issue: jest.fn() };
    const addresses = { list: jest.fn(), create: jest.fn(), remove: jest.fn() };
    const fares = { current: jest.fn(), publish: jest.fn() };
    const c = new DeliveryController(areas as never, quotes as never, addresses as never);
    c.listAreas();
    c.options('L1', { areaId: 4 }, user);
    c.quote({ listingId: 'L1', quantity: 1, addressId: 'A1' }, user);
    c.myAddresses(user);
    c.addAddress({ kind: 'dropoff', label: 'Home', areaId: 4, line1: 'Road', contactName: 'R' }, user);
    await c.removeAddress('A1', user);
    expect(quotes.options).toHaveBeenCalledWith('U1', 'L1', 4, 1);
    expect(quotes.issue).toHaveBeenCalledWith('U1', { listingId: 'L1', quantity: 1, addressId: 'A1' });
    expect(addresses.remove).toHaveBeenCalledWith('U1', 'A1');
    expect(() => c.myAddresses(staff)).toThrow(Problem);

    const a = new DeliveryAdminController(areas as never, fares as never, { list: jest.fn(), create: jest.fn(), update: jest.fn() } as never);
    a.addArea({ district: 'Dhaka', nameEn: 'Savar', nameBn: 'সাভার', zone: 'dhaka_suburbs', lat: 23.858, lng: 90.267 }, staff);
    a.changeArea(4, { active: false }, staff);
    a.currentFares();
    a.publishFares({ source: 'RedX merchant rates', rows: [] }, staff);
    expect(areas.update).toHaveBeenCalledWith('S1', 4, { active: false });
    expect(fares.publish).toHaveBeenCalledWith('S1', { source: 'RedX merchant rates', rows: [] });
    expect(() => a.addArea({} as never, user)).toThrow(Problem);
  });
});
