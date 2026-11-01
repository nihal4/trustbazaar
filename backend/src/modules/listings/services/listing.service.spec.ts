import { randomUUID } from 'crypto';
import { DataSource, QueryFailedError } from 'typeorm';
import { ConfigPort, parameterValues } from '../../../kernel/config-port';
import { EventBus } from '../../../kernel/events/event-bus';
import type { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { Problem } from '../../../kernel/http/problems';
import type { IdentityQuery } from '../../identity/ports';
import { Auction, AuctionsOutboxEvent, Category, Clarification, Listing, ListingPhoto, ListingStatusChange } from '../db/entities';
import { fieldErrors, ListingService } from './listing.service';
import { MediaPipeline, PhotoRejected } from './media';
import { ScreeningService } from './screening.service';
import { StockService } from './stock.service';

// Unit tests of ListingService and StockService over an in-memory stand-in for TypeORM: the rules and
// branches of the services. The same behaviour against PostgreSQL, with its triggers, is in
// test/api/listings.spec.ts.

type Row = Record<string, unknown>;
const matches = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => row[k] === v);

class Repo {
  rows: Row[] = [];
  constructor(
    private readonly pk: string,
    private readonly defaults: () => Row = () => ({}),
  ) {}
  async findOne(o: { where: Row }) {
    return this.rows.find((r) => matches(r, o.where)) ?? null;
  }
  async findOneBy(where: Row) {
    return this.rows.find((r) => matches(r, where)) ?? null;
  }
  async findOneByOrFail(where: Row) {
    const r = await this.findOneBy(where);
    if (!r) throw new Error('EntityNotFound');
    return r;
  }
  async findBy(where: Row) {
    return this.rows.filter((r) => matches(r, where));
  }
  async find(o: { where?: Row; order?: Record<string, 'ASC' | 'DESC'> } = {}) {
    const [key] = Object.keys(o.order ?? {});
    const rows = this.rows.filter((r) => matches(r, o.where));
    return key ? [...rows].sort((a, b) => ((a[key] as number) > (b[key] as number) ? 1 : -1)) : rows;
  }
  async insert(obj: Row) {
    const row = { [this.pk]: randomUUID(), ...this.defaults(), ...obj };
    this.rows.push(row);
    return { identifiers: [{ [this.pk]: row[this.pk] }] };
  }
  async update(where: Row, patch: Row) {
    for (const r of this.rows.filter((x) => matches(x, where))) Object.assign(r, patch);
  }
}

function fakeDb(query: (sql: string, params: unknown[]) => unknown[] = () => []) {
  const repos = new Map<unknown, Repo>([
    [Listing, new Repo('id', () => ({
      status: 'draft', quantityReserved: 0, quantitySold: 0, lockedAt: null, sellerVisible: true, publishedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    }))],
    [Category, new Repo('id')],
    [ListingPhoto, new Repo('id', () => ({ removedAt: null, createdAt: new Date() }))],
    [Clarification, new Repo('id', () => ({ createdAt: new Date() }))],
    [ListingStatusChange, new Repo('id')],
    [Auction, new Repo('listingId')],
    [AuctionsOutboxEvent, new Repo('id')],
  ]);
  const manager = {
    getRepository: (e: unknown) => repos.get(e)!,
    query: jest.fn(async (sql: string, params: unknown[] = []) => query(sql, params)),
  };
  const db = { ...manager, manager, transaction: (cb: (m: typeof manager) => unknown) => cb(manager) };
  return { db, manager, repo: (e: unknown) => repos.get(e)! };
}

const PARAMS = {
  'CP-07': ['1 hour', '24 hours'], 'CP-08': { bps: 200, min_poisha: 5000 }, 'CP-09': { window: '2 minutes', extension: '2 minutes' },
  'CP-28': { standard: 2, pro: 5 }, 'CP-33': { image_bytes: 1000, photos: 3 }, 'CP-36': true,
};

function setup(o: { query?: (sql: string, params: unknown[]) => unknown[]; params?: Row; matches?: { term: string; severity: string }[] } = {}) {
  const f = fakeDb(o.query);
  const media = {
    store: jest.fn(async () => ({ key: 'a'.repeat(32), width: 800, height: 600 })),
    remove: jest.fn(async () => undefined),
    path: jest.fn((key: string, size: string) => `/files/${key}-${size}`),
  };
  const screening = { matches: jest.fn(async () => o.matches ?? []) };
  const idempotency = { once: async (_s: string, _u: string, _k: string | undefined, fn: () => Promise<string>) => ({ id: await fn(), repeated: false }) };
  const identity = {
    getApproxArea: jest.fn(async () => ({ district: 'Khulna', lat: 22.84567, lng: 89.54012 })),
    getPublicProfile: jest.fn(async (id: string) => ({ id, displayName: 'Seller', verified: true, joinMonth: '2026-10', district: 'Khulna' })),
  };
  const values = parameterValues({ ...PARAMS, ...(o.params ?? {}) });
  const params = { current: async () => ({ ...values, version: 1 }) } as unknown as ConfigPort;
  const svc = new ListingService(
    f.db as unknown as DataSource, media as unknown as MediaPipeline, screening as unknown as ScreeningService,
    idempotency as unknown as IdempotencyKeys, identity as unknown as IdentityQuery, params,
  );
  const cat = (id: number, itemKind = 'physical', prohibited = false) =>
    f.repo(Category).rows.push({ id, slug: `c${id}`, nameEn: 'Phones', nameBn: 'ফোন', itemKind, prohibited, parentId: null, sortOrder: id });
  cat(1);
  cat(2, 'game_account');
  cat(3, 'physical', true);
  return { ...f, svc, media, screening, identity };
}

const SELLER = 'seller-1';
const phone = (o: Row = {}) => ({
  itemKind: 'physical', saleFormat: 'fixed_price', categoryId: 1, title: '  Used phone  ', description: 'A used phone in good condition.',
  condition: 'used', noVisibleDefects: true, fulfilmentOptions: 'pickup_only', price: '100000', ...o,
}) as never;

const problemOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    if (err instanceof Problem) return { problem: err.problem, errors: (err.extra.errors as { field: string; reason: string }[] | undefined)?.map((e) => `${e.field}:${e.reason}`) };
    throw err;
  }
  throw new Error('no problem raised');
};

async function withPhotos(s: ReturnType<typeof setup>, o: Row = {}, n = 2) {
  const { listing } = await s.svc.create(SELLER, phone(o), undefined);
  for (let i = 1; i <= n; i++) s.repo(ListingPhoto).rows.push({ id: `p${i}`, listingId: listing.id, position: i, storageKey: `${i}`.repeat(32), width: 1, height: 1, showsDefects: false, removedAt: null });
  return listing.id;
}

describe('ListingService', () => {
  it('FR-LST-10 categories: prohibited ones are listed but not selectable', async () => {
    const s = setup();
    expect((await s.svc.categories()).map((c) => [c.id, c.selectable])).toEqual([[1, true], [2, true], [3, false]]);
  });

  it('FR-LST-01 a draft is created with trimmed text and its history; the saved area is the default, rounded (FR-LST-06)', async () => {
    const s = setup();
    const { listing } = await s.svc.create(SELLER, phone(), undefined);
    expect(listing).toMatchObject({ status: 'draft', title: 'Used phone', district: 'Khulna', own: { area: { lat: 22.846, lng: 89.54 } } });
    expect(s.repo(ListingStatusChange).rows).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'draft', actorId: SELLER })]);
    s.identity.getApproxArea.mockResolvedValueOnce(null as never);
    expect(await problemOf(s.svc.create(SELLER, phone(), undefined))).toEqual({ problem: 'validation-failed', errors: ['area:required'] });
  });

  it('FR-LST-10 unknown, prohibited and mismatched categories are refused', async () => {
    const s = setup();
    for (const [categoryId, reason] of [[9, 'unknown'], [3, 'prohibited'], [2, 'item-kind']] as const) {
      expect((await problemOf(s.svc.create(SELLER, phone({ categoryId }), undefined))).errors).toContain(`categoryId:${reason}`);
    }
  });

  it('SEC-INP-01 a rule only the database knows comes back as a validation error naming the rule', async () => {
    const s = setup();
    const err = new QueryFailedError('INSERT', [], Object.assign(new Error('check'), { code: '23514', constraint: 'location_pair' }));
    s.repo(Listing).insert = async () => Promise.reject(err);
    expect(await problemOf(s.svc.create(SELLER, phone(), undefined))).toEqual({ problem: 'validation-failed', errors: ['listing:location_pair'] });
    s.repo(Listing).insert = async () => Promise.reject(new Error('connection lost'));
    await expect(s.svc.create(SELLER, phone(), undefined)).rejects.toThrow('connection lost');
  });

  it('FR-LST-03 and I-23 the item details: courier parcels, game accounts, single units', () => {
    const base = { itemKind: 'physical', saleFormat: 'fixed_price', categoryId: 1, title: 't', description: 'd', condition: 'used', noVisibleDefects: true, fulfilmentOptions: 'courier_only', weightClass: 'over_10kg', sizeClass: 'oversize', price: '1', quantityTotal: 1, areaDistrict: 'Dhaka', approxLat: '23', approxLng: '90' } as never;
    const cat = { itemKind: 'physical', prohibited: false } as never;
    expect(fieldErrors(base, cat)).toEqual([{ field: 'weightClass', reason: 'no-courier-over-10kg' }, { field: 'sizeClass', reason: 'no-courier-oversize' }]);
    expect(fieldErrors({ ...(base as object), weightClass: null, sizeClass: null } as never, cat).map((e) => e.reason)).toEqual(['required-for-courier', 'required-for-courier']);
    const game = { ...(base as object), itemKind: 'game_account', saleFormat: 'auction', price: null, quantityTotal: 2 } as never;
    expect(fieldErrors(game, { itemKind: 'game_account', prohibited: false } as never).map((e) => `${e.field}:${e.reason}`)).toEqual([
      'quantity:single-unit', 'condition:not-for-game-accounts', 'fulfilmentOptions:not-for-game-accounts', 'weightClass:not-for-game-accounts', 'sizeClass:not-for-game-accounts',
    ]);
  });

  it('FR-LST-07 a draft changes freely; an active listing only text, price and quantity until locked', async () => {
    const s = setup();
    const { listing } = await s.svc.create(SELLER, phone(), undefined);
    const id = listing.id;
    const edited = await s.svc.update(SELLER, id, {
      categoryId: 1, title: 'New title', description: 'A new description of the phone.', condition: 'like_new', noVisibleDefects: false,
      fulfilmentOptions: 'pickup_or_courier', weightClass: 'up_to_1kg', sizeClass: 'small', price: '90000', quantity: 3,
      area: { district: 'Dhaka', lat: 23.81, lng: 90.41 },
    });
    expect(edited).toMatchObject({ title: 'New title', price: '90000', quantity: { total: 3, available: 3 }, district: 'Dhaka' });
    const row = s.repo(Listing).rows[0];
    row.status = 'active';
    expect(await problemOf(s.svc.update(SELLER, id, { categoryId: 1, condition: 'used' }))).toEqual({
      problem: 'listing-state', errors: ['categoryId:fixed-after-publication', 'condition:fixed-after-publication'],
    });
    expect((await s.svc.update(SELLER, id, { title: 'Active title' })).title).toBe('Active title');
    row.lockedAt = new Date();
    expect((await problemOf(s.svc.update(SELLER, id, { title: 'Too late now' }))).problem).toBe('listing-locked');
    row.status = 'sold';
    expect((await problemOf(s.svc.update(SELLER, id, { title: 'Sold already' }))).problem).toBe('listing-state');
    expect((await problemOf(s.svc.update('someone-else', id, { title: 'Not mine' }))).problem).toBe('not-found');
    expect((await problemOf(s.svc.update(SELLER, id, { categoryId: 3 }))).problem).toBe('listing-state');
  });

  it('FR-LST-07 an active auction never changes price or quantity', async () => {
    const s = setup();
    const { listing } = await s.svc.create(SELLER, phone({ saleFormat: 'auction', price: undefined }), undefined);
    s.repo(Listing).rows[0].status = 'active';
    expect((await problemOf(s.svc.update(SELLER, listing.id, { quantity: 1 }))).errors).toEqual(['quantity:fixed-after-publication']);
    s.repo(Listing).rows[0].status = 'draft';
    expect((await problemOf(s.svc.update(SELLER, listing.id, { title: 'Ok title', categoryId: 2 }))).errors).toContain('categoryId:item-kind');
  });

  it('CP-33 photos: stored, numbered in the first free place, at most the limit; a refused or failed one leaves no file', async () => {
    const s = setup();
    const id = await withPhotos(s, {}, 0);
    expect((await problemOf(s.svc.addPhoto(SELLER, id, undefined, false))).errors).toEqual(['photo:required']);
    const p = await s.svc.addPhoto(SELLER, id, Buffer.from('x'), true);
    expect(p).toMatchObject({ position: 1, showsDefects: true, url: `/api/v1/listing-photos/${'a'.repeat(32)}`, thumbUrl: expect.stringMatching(/size=thumb$/) });
    expect(s.media.store).toHaveBeenCalledWith(Buffer.from('x'), 1000);
    s.repo(ListingPhoto).rows[0].removedAt = new Date();
    expect((await s.svc.addPhoto(SELLER, id, Buffer.from('x'), false)).position).toBe(1);
    await s.svc.addPhoto(SELLER, id, Buffer.from('x'), false);
    await s.svc.addPhoto(SELLER, id, Buffer.from('x'), false);
    expect((await problemOf(s.svc.addPhoto(SELLER, id, Buffer.from('x'), false))).problem).toBe('photo-limit');
    expect(s.media.remove).toHaveBeenCalledTimes(1);
    s.media.store.mockRejectedValueOnce(new PhotoRejected('not-an-image') as never);
    expect((await problemOf(s.svc.addPhoto(SELLER, id, Buffer.from('x'), false))).errors).toEqual(['photo:not-an-image']);
    s.media.store.mockRejectedValueOnce(new Error('disk full') as never);
    await expect(s.svc.addPhoto(SELLER, id, Buffer.from('x'), false)).rejects.toThrow('disk full');
  });

  it('FR-LST-07 photos change only while the listing is editable', async () => {
    const s = setup();
    const id = await withPhotos(s);
    const row = s.repo(Listing).rows[0];
    row.status = 'active';
    row.lockedAt = new Date();
    expect((await problemOf(s.svc.addPhoto(SELLER, id, Buffer.from('x'), false))).problem).toBe('listing-locked');
    row.status = 'pending_review';
    expect((await problemOf(s.svc.removePhoto(SELLER, id, 'p1'))).problem).toBe('listing-state');
  });

  it('FR-LST-02 an active listing keeps two photos and its defect photo', async () => {
    const s = setup();
    const id = await withPhotos(s, { noVisibleDefects: false }, 3);
    const row = s.repo(Listing).rows[0];
    s.repo(ListingPhoto).rows[2].showsDefects = true;
    row.status = 'active';
    expect((await problemOf(s.svc.removePhoto(SELLER, id, 'p3'))).errors).toEqual(['photos:defect-photo-needed']);
    await s.svc.removePhoto(SELLER, id, 'p1');
    expect(s.media.remove).toHaveBeenCalledWith('1'.repeat(32));
    expect((await problemOf(s.svc.removePhoto(SELLER, id, 'p2'))).errors).toEqual(['photos:two-needed']);
    expect((await problemOf(s.svc.removePhoto(SELLER, id, 'p1'))).problem).toBe('not-found');
  });

  it('SEC-INP-04 only the photos shown are served, by storage key', async () => {
    const s = setup();
    await withPhotos(s);
    expect(await s.svc.photoFile('1'.repeat(32), 'thumb')).toBe(`/files/${'1'.repeat(32)}-thumb`);
    expect((await problemOf(s.svc.photoFile('../x', 'full'))).problem).toBe('not-found');
    expect((await problemOf(s.svc.photoFile('f'.repeat(32), 'full'))).problem).toBe('not-found');
    s.repo(ListingPhoto).rows[0].removedAt = new Date();
    expect((await problemOf(s.svc.photoFile('1'.repeat(32), 'full'))).problem).toBe('not-found');
  });

  it('FR-LST-12 publication: active, announced, with history; only from draft', async () => {
    const s = setup({ query: (sql) => (sql.includes('count(*)') ? [{ n: 0 }] : []) });
    const id = await withPhotos(s);
    const v = await s.svc.publish(SELLER, id, {});
    expect(v).toMatchObject({ status: 'active', publishedAt: expect.any(String) });
    expect(s.repo(AuctionsOutboxEvent).rows).toEqual([expect.objectContaining({ eventType: 'listings.listing.published', aggregateId: id })]);
    expect(s.repo(ListingStatusChange).rows[1]).toMatchObject({ fromStatus: 'draft', toStatus: 'active', reason: 'published' });
    expect(s.manager.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect((await problemOf(s.svc.publish(SELLER, id, {}))).problem).toBe('listing-state');
  });

  it('FR-LST-02 publication names every missing piece at once', async () => {
    const s = setup({ query: () => [{ n: 0 }] });
    const id = await withPhotos(s, { noVisibleDefects: false }, 1);
    expect((await problemOf(s.svc.publish(SELLER, id, { startPrice: '1', duration: '1 hour' }))).errors).toEqual([
      'startPrice:auctions-only', 'duration:auctions-only', 'photos:two-needed', 'photos:defect-photo-or-declaration',
    ]);
  });

  it('FR-LST-09 the listing limit CP-28 and FR-LST-11 the screening hold', async () => {
    let active = 2;
    const s = setup({ query: (sql) => (sql.includes('count(*)') ? [{ n: active }] : []), matches: [{ term: 'replica', severity: 'prohibited' }] });
    const id = await withPhotos(s);
    expect((await problemOf(s.svc.publish(SELLER, id, {}))).problem).toBe('listing-limit');
    active = 1;
    expect((await s.svc.publish(SELLER, id, {})).status).toBe('pending_review');
    expect(s.repo(ListingStatusChange).rows[1].reason).toBe('held for review: screening terms "replica" (prohibited)');
    expect(s.repo(AuctionsOutboxEvent).rows).toEqual([]);
  });

  it('I-30 game accounts wait for review, and are refused while CP-36 is off', async () => {
    const s = setup({ query: () => [{ n: 0 }] });
    const { listing } = await s.svc.create(SELLER, { itemKind: 'game_account', saleFormat: 'fixed_price', categoryId: 2, title: 'Game account', description: 'An account with many skins.', price: '5000' } as never, undefined);
    expect(s.identity.getApproxArea).not.toHaveBeenCalled();
    const off = setup({ params: { 'CP-36': false } });
    off.repo(Listing).rows.push({ ...s.repo(Listing).rows[0] });
    expect((await problemOf(off.svc.publish(SELLER, listing.id, {}))).problem).toBe('feature-off');
    expect((await s.svc.publish(SELLER, listing.id, {})).status).toBe('pending_review');
    expect(s.repo(ListingStatusChange).rows[1].reason).toBe('held for review: game-account ownership approval');
  });

  it('FR-AUC-01 an auction is published with its terms and the CP-08 and CP-09 values of the day', async () => {
    const s = setup({ query: () => [{ n: 0 }] });
    const id = await withPhotos(s, { saleFormat: 'auction', price: undefined });
    expect((await problemOf(s.svc.publish(SELLER, id, { reservePrice: '50' }))).errors).toEqual(['startPrice:required', 'duration:one-of-cp-07']);
    expect((await problemOf(s.svc.publish(SELLER, id, { startPrice: '100', reservePrice: '50', duration: '1 hour' }))).errors).toEqual(['reservePrice:below-start-price']);
    s.repo(Auction).rows.push({ listingId: id, status: 'open', startPrice: '100', currentPrice: null, reservePrice: '200', bidCount: 0, endAt: new Date() });
    const v = await s.svc.publish(SELLER, id, { startPrice: '100', reservePrice: '200', duration: '24 hours' });
    const insert = s.manager.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO auctions.auctions'))!;
    expect(insert[1]).toEqual([id, SELLER, '100', '200', 200, 5000, '2 minutes', '2 minutes', '24 hours']);
    expect(v.auction).toMatchObject({ hasReserve: true, reserveMet: false, reservePrice: '200' });
  });

  it('FR-LST-07 clarifications: only on an active listing, never empty', async () => {
    const s = setup();
    const id = await withPhotos(s);
    expect((await problemOf(s.svc.clarify(SELLER, id, '   '))).errors).toEqual(['body:empty']);
    expect((await problemOf(s.svc.clarify(SELLER, id, 'Too early'))).problem).toBe('listing-state');
    s.repo(Listing).rows[0].status = 'active';
    expect(await s.svc.clarify(SELLER, id, ' Charger included. ')).toMatchObject({ body: 'Charger included.', at: expect.any(String) });
  });

  it('FR-LST-08 cancelling: a draft, an active listing without reservations, an auction without bids; nothing else', async () => {
    const s = setup();
    const draft = await withPhotos(s);
    expect((await s.svc.cancel(SELLER, draft)).status).toBe('cancelled');
    expect(s.repo(AuctionsOutboxEvent).rows).toEqual([]);
    expect((await problemOf(s.svc.cancel(SELLER, draft))).problem).toBe('listing-state');

    const fixed = await withPhotos(s);
    const row = s.repo(Listing).rows.find((r) => r.id === fixed)!;
    Object.assign(row, { status: 'active', quantityReserved: 1 });
    expect((await problemOf(s.svc.cancel(SELLER, fixed))).errors).toEqual(['listing:order-in-progress']);
    row.quantityReserved = 0;
    await s.svc.cancel(SELLER, fixed);
    expect(s.repo(AuctionsOutboxEvent).rows).toEqual([expect.objectContaining({ eventType: 'listings.listing.cancelled' })]);

    const auction = await withPhotos(s, { saleFormat: 'auction', price: undefined });
    s.repo(Listing).rows.find((r) => r.id === auction)!.status = 'active';
    const a = { listingId: auction, status: 'open', startPrice: '100', currentPrice: '120', reservePrice: null, bidCount: 1, endAt: new Date() };
    s.repo(Auction).rows.push(a);
    expect((await problemOf(s.svc.cancel(SELLER, auction))).errors).toEqual(['listing:auction-has-bids']);
    a.bidCount = 0;
    expect((await s.svc.cancel(SELLER, auction)).auction).toMatchObject({ status: 'cancelled', reserveMet: true });
  });

  it('FR-SRC-04 and I-30 who sees a listing page', async () => {
    const s = setup();
    const id = await withPhotos(s);
    const row = s.repo(Listing).rows[0];
    const guest = { type: 'user', userId: 'guest' } as never;
    expect((await problemOf(s.svc.view(id, guest))).problem).toBe('not-found');
    expect((await s.svc.view(id, { type: 'user', userId: SELLER } as never)).own).toBeDefined();
    row.status = 'active';
    expect((await s.svc.view(id, undefined)).own).toBeUndefined();
    expect((await s.svc.view(id, { type: 'staff', staffId: 's' } as never)).status).toBe('active');
    row.sellerVisible = false;
    expect((await problemOf(s.svc.view(id, undefined))).problem).toBe('not-found');
    expect((await problemOf(s.svc.view(randomUUID(), undefined))).problem).toBe('not-found');
    const off = setup({ params: { 'CP-36': false } });
    off.repo(Listing).rows.push({ ...row, itemKind: 'game_account', sellerVisible: true });
    expect((await problemOf(off.svc.view(id, undefined))).problem).toBe('not-found');
  });

  it('FR-LST-12 my listings in pages of 50, with a cursor', async () => {
    const at = new Date('2026-11-01T10:00:00Z');
    const rows = Array.from({ length: 51 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: 't', status: 'draft', item_kind: 'physical', sale_format: 'fixed_price', price: '1', quantity_total: 1, quantity_available: 1, created_at: at, cursor_at: '2026-11-01T10:00:00.123456Z', published_at: null, photo_key: i === 0 ? 'b'.repeat(32) : null }));
    const s = setup({ query: () => rows });
    const page = await s.svc.mine(SELLER, 'draft', undefined);
    expect(page.items).toHaveLength(50);
    expect(page.items[0].thumbUrl).toMatch(/size=thumb$/);
    const [atText, lastId] = Buffer.from(page.nextCursor!, 'base64url').toString().split('|');
    expect([atText, lastId]).toEqual(['2026-11-01T10:00:00.123456Z', rows[49].id]); // the database's microseconds, not the Date's milliseconds
    await s.svc.mine(SELLER, undefined, page.nextCursor!);
    expect(s.manager.query.mock.calls[1][1]).toEqual([SELLER, null, '2026-11-01T10:00:00.123456Z', rows[49].id]);
    expect((await problemOf(s.svc.mine(SELLER, undefined, 'bm9wZQ'))).errors).toEqual(['cursor:format']);
    const short = setup({ query: () => rows.slice(0, 3) });
    expect((await short.svc.mine(SELLER, undefined, undefined)).nextCursor).toBeNull();
  });
});

describe('StockService (ListingsPort, I-9)', () => {
  function stock(query: (sql: string) => unknown[] = () => []) {
    const f = fakeDb((sql) => query(sql));
    const bus = new EventBus();
    const svc = new StockService(f.db as unknown as DataSource, bus);
    svc.onModuleInit();
    f.repo(Category).rows.push({ id: 1, slug: 'phones', nameEn: 'Phones', nameBn: 'ফোন' });
    const listing = (o: Row = {}) => {
      const row = { id: randomUUID(), sellerId: SELLER, itemKind: 'physical', saleFormat: 'fixed_price', status: 'active', categoryId: 1, title: 't', description: 'd', price: '100', ...o };
      f.repo(Listing).rows.push(row);
      return row;
    };
    return { ...f, svc, bus, listing };
  }

  it('DC-13 reserve, release and markSold are the single statements of the database', async () => {
    const s = stock((sql) => (sql.includes('reserve') ? [{ ok: true }] : sql.includes('SELECT status') ? [{ status: 'active' }] : []));
    const l = s.listing();
    expect(await s.svc.reserve(l.id, 2, s.manager as never)).toBe(true);
    await s.svc.release(l.id, 1, s.manager as never);
    await s.svc.markSold(l.id, 1, s.manager as never);
    expect(s.manager.query.mock.calls.map((c) => String(c[0]).match(/listings\.\w+/)?.[0])).toEqual(['listings.reserve', 'listings.release', 'listings.mark_sold', 'listings.listings']);
    expect(s.repo(AuctionsOutboxEvent).rows).toEqual([]);
    await expect(s.svc.markSold(randomUUID(), 1, s.manager as never)).rejects.toBeInstanceOf(Problem);
  });

  it('FR-FIX-04 the last unit sold makes the listing sold, recorded and announced', async () => {
    const s = stock((sql) => (sql.includes('SELECT status') ? [{ status: 'sold' }] : []));
    const l = s.listing();
    await s.svc.markSold(l.id, 1, s.manager as never);
    expect(s.repo(ListingStatusChange).rows).toEqual([expect.objectContaining({ fromStatus: 'active', toStatus: 'sold', actorType: 'system' })]);
    expect(s.repo(AuctionsOutboxEvent).rows).toEqual([expect.objectContaining({ eventType: 'listings.listing.sold', aggregateId: l.id })]);
  });

  it('I-9 the order events are registered and move stock once per order', async () => {
    let inserted = true;
    const s = stock((sql) => (sql.includes('stock_moves') ? (inserted ? [{ order_id: 'o' }] : []) : sql.includes('SELECT status') ? [{ status: 'active' }] : []));
    expect(s.bus.consumersOf('orders.order.paid').map((c) => c.name)).toEqual(['listings.stock']);
    expect(s.bus.consumersOf('orders.order.cancelled').map((c) => c.name)).toEqual(['listings.stock']);
    const l = s.listing();
    await s.svc.onOrder({ aggregateId: 'o1', payload: { listingId: l.id, quantity: 1 } }, 'sold');
    await s.svc.onOrder({ aggregateId: 'o2', payload: { listingId: l.id, quantity: 1 } }, 'released');
    inserted = false;
    await s.svc.onOrder({ aggregateId: 'o2', payload: { listingId: l.id, quantity: 1 } }, 'released');
    const calls = s.manager.query.mock.calls.map((c) => String(c[0]).match(/listings\.(mark_sold|release)/)?.[1]).filter(Boolean);
    expect(calls).toEqual(['mark_sold', 'release']);
  });

  it('I-9 auction orders are left to the closer; a bad event is reported, not swallowed', async () => {
    const s = stock();
    const a = s.listing({ saleFormat: 'auction' });
    await s.svc.onOrder({ aggregateId: 'o', payload: { listingId: a.id, quantity: 1 } }, 'sold');
    expect(s.manager.query).not.toHaveBeenCalled();
    await expect(s.svc.onOrder({ aggregateId: 'o', payload: { listingId: a.id } }, 'sold')).rejects.toThrow('lacks listingId or quantity');
    await expect(s.svc.onOrder({ aggregateId: 'o', payload: { listingId: randomUUID(), quantity: 1 } }, 'sold')).rejects.toThrow('unknown listing');
    const [handler] = s.bus.consumersOf('orders.order.cancelled');
    await expect(handler.handler({ aggregateId: 'o', payload: {} } as never)).rejects.toThrow();
  });

  it('FR-FIX-01 the order keeps a copy of the listing as shown, the photos in order (DR-03)', async () => {
    const s = stock();
    const l = s.listing({ condition: 'used', noVisibleDefects: true, fulfilmentOptions: 'pickup_only', weightClass: null, sizeClass: null, areaDistrict: 'Dhaka' });
    s.repo(ListingPhoto).rows.push({ listingId: l.id, position: 2, storageKey: 'k2', removedAt: null }, { listingId: l.id, position: 1, storageKey: 'k1', removedAt: null }, { listingId: l.id, position: 3, storageKey: 'k3', removedAt: new Date() });
    s.repo(Clarification).rows.push({ listingId: l.id, body: 'Box included', createdAt: new Date() });
    const snap = await s.svc.snapshot(l.id);
    expect(snap).toMatchObject({ listingId: l.id, district: 'Dhaka', photoKeys: ['k1', 'k2'], clarifications: [{ body: 'Box included' }], category: { slug: 'phones' } });
    await expect(s.svc.snapshot(randomUUID())).rejects.toBeInstanceOf(Problem);
  });
});
