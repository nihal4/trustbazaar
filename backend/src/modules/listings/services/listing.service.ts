import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { CONFIG_PORT, ConfigPort } from '../../../kernel/config-port';
import { cursorAt, decodeCursor, encodeCursor } from '../../../kernel/http/cursor';
import { IdempotencyKeys } from '../../../kernel/http/idempotency';
import { Problem } from '../../../kernel/http/problems';
import type { Principal } from '../../../kernel/http/principal';
import { IDENTITY_QUERY, IdentityQuery } from '../../identity/ports';
import { Auction, Category, Clarification, Listing, ListingPhoto, ListingStatusChange } from '../db/entities';
import type { CreateListingDto, PublishListingDto, UpdateListingDto } from '../http/listings.dto';
import type { ListingStatus } from '../ports';
import { MediaPipeline, PhotoRejected, PhotoSize, STORAGE_KEY } from './media';
import { readAuctionState } from './auction-state';
import { publish } from './outbox';
import { ScreeningService } from './screening.service';

// ListingService (docs/design/03_listings_auctions.pdf section 6.1; FR-LST-01 to FR-LST-12, FR-LST-07 to 08).
// Every change locks the listing row first (DC-14), checks that the caller is its seller and that its status
// allows the change, and writes the status history and outbox events in the same transaction (DC-6). The
// database triggers check the same rules again: photos and declaration at publication, content locked after
// the first bid or order, and the permitted status changes.

export type FieldError = { field: string; reason: string };
type Fields = Pick<
  Listing,
  | 'itemKind' | 'saleFormat' | 'categoryId' | 'title' | 'description' | 'condition' | 'noVisibleDefects' | 'fulfilmentOptions'
  | 'weightClass' | 'sizeClass' | 'price' | 'quantityTotal' | 'areaDistrict' | 'approxLat' | 'approxLng'
>;

/** What an editable active listing may still change (FR-LST-07); a draft may change everything. */
const ACTIVE_EDITABLE = new Set(['title', 'description', 'price', 'quantity']);
const PUBLIC_STATUSES: ListingStatus[] = ['active', 'sold', 'ended_unsold'];
const PAGE = 50;

export const photoUrl = (key: string, size: PhotoSize = 'full') =>
  size === 'full' ? `/api/v1/listing-photos/${key}` : `/api/v1/listing-photos/${key}?size=thumb`;
const round3 = (x: number) => (Math.round(x * 1000) / 1000).toFixed(3);
const userOf = (p: Principal | undefined) => (p?.type === 'user' ? p.userId : undefined);

const FIELD_KEYS = [
  'itemKind', 'saleFormat', 'categoryId', 'title', 'description', 'condition', 'noVisibleDefects', 'fulfilmentOptions',
  'weightClass', 'sizeClass', 'price', 'quantityTotal', 'areaDistrict', 'approxLat', 'approxLng',
] as const satisfies readonly (keyof Fields)[];
const fieldsOf = (l: Listing): Fields => Object.fromEntries(FIELD_KEYS.map((k) => [k, l[k]])) as Fields;

/** The rules the database also enforces, checked first so the seller learns every problem at once. */
export function fieldErrors(f: Fields, category: Pick<Category, 'itemKind' | 'prohibited'> | null): FieldError[] {
  const e: FieldError[] = [];
  if (!category) e.push({ field: 'categoryId', reason: 'unknown' });
  else if (category.prohibited) e.push({ field: 'categoryId', reason: 'prohibited' }); // FR-LST-10
  else if (category.itemKind !== f.itemKind) e.push({ field: 'categoryId', reason: 'item-kind' });
  if (f.saleFormat === 'fixed_price' && f.price === null) e.push({ field: 'price', reason: 'required' });
  if (f.saleFormat === 'auction' && f.price !== null) e.push({ field: 'price', reason: 'auction-sets-start-price-at-publication' });
  if (f.quantityTotal > 1 && (f.saleFormat === 'auction' || f.itemKind === 'game_account')) e.push({ field: 'quantity', reason: 'single-unit' });
  if (f.itemKind === 'physical') {
    if (f.condition === null) e.push({ field: 'condition', reason: 'required' });
    if (f.noVisibleDefects === null) e.push({ field: 'noVisibleDefects', reason: 'required' });
    if (f.fulfilmentOptions === null) e.push({ field: 'fulfilmentOptions', reason: 'required' });
    if (f.areaDistrict === null) e.push({ field: 'area', reason: 'required' });
    if (f.fulfilmentOptions && f.fulfilmentOptions !== 'pickup_only') {
      if (f.weightClass === null) e.push({ field: 'weightClass', reason: 'required-for-courier' });
      if (f.sizeClass === null) e.push({ field: 'sizeClass', reason: 'required-for-courier' });
      // I-23: no courier fare covers these (Unit 4 DV-24, DV-25)
      if (f.weightClass === 'over_10kg') e.push({ field: 'weightClass', reason: 'no-courier-over-10kg' });
      if (f.sizeClass === 'oversize') e.push({ field: 'sizeClass', reason: 'no-courier-oversize' });
    }
  } else {
    for (const k of ['condition', 'fulfilmentOptions', 'weightClass', 'sizeClass'] as const) {
      if (f[k] !== null) e.push({ field: k, reason: 'not-for-game-accounts' });
    }
  }
  return e;
}

/** A refusal by a database rule that the checks above did not foresee: a 400 naming the rule. */
function fromDatabase(err: unknown): never {
  if (err instanceof QueryFailedError) {
    const d = err.driverError as { code?: string; constraint?: string };
    if (d.code === '23514') throw new Problem('validation-failed', { errors: [{ field: 'listing', reason: d.constraint ?? 'rule' }] });
  }
  throw err;
}

@Injectable()
export class ListingService {
  constructor(
    private readonly db: DataSource,
    private readonly media: MediaPipeline,
    private readonly screening: ScreeningService,
    private readonly idempotency: IdempotencyKeys,
    @Inject(IDENTITY_QUERY) private readonly identity: IdentityQuery,
    @Inject(CONFIG_PORT) private readonly params: ConfigPort,
  ) {}

  // ---------------------------------------------------------------- categories (FR-LST-10)

  async categories() {
    const rows = await this.db.getRepository(Category).find({ order: { sortOrder: 'ASC', id: 'ASC' } });
    return rows.map((c) => ({
      id: c.id, parentId: c.parentId, slug: c.slug, nameEn: c.nameEn, nameBn: c.nameBn, itemKind: c.itemKind,
      selectable: !c.prohibited, // prohibited categories are shown as policy only
    }));
  }

  // ---------------------------------------------------------------- drafts (FR-LST-01 to FR-LST-06)

  /** A new draft; with an Idempotency-Key, a repeated request returns the first draft (I-53). */
  async create(userId: string, dto: CreateListingDto, idempotencyKey: string | undefined) {
    const { id, repeated } = await this.idempotency.once('listing', userId, idempotencyKey, async () => {
      const area = dto.area ?? (dto.itemKind === 'physical' ? await this.identity.getApproxArea(userId) : null);
      const f: Fields = {
        itemKind: dto.itemKind, saleFormat: dto.saleFormat, categoryId: dto.categoryId,
        title: dto.title.trim(), description: dto.description.trim(),
        condition: dto.condition ?? null, noVisibleDefects: dto.noVisibleDefects ?? null,
        fulfilmentOptions: dto.fulfilmentOptions ?? null, weightClass: dto.weightClass ?? null, sizeClass: dto.sizeClass ?? null,
        price: dto.price ?? null, quantityTotal: dto.quantity ?? 1,
        areaDistrict: area?.district?.trim() || null,
        approxLat: area ? round3(area.lat) : null, approxLng: area ? round3(area.lng) : null,
      };
      if (f.areaDistrict === null) [f.approxLat, f.approxLng] = [null, null];
      return this.db
        .transaction(async (m) => {
          const errors = fieldErrors(f, await m.getRepository(Category).findOneBy({ id: f.categoryId }));
          if (errors.length) throw new Problem('validation-failed', { errors });
          const { identifiers } = await m.getRepository(Listing).insert({
            ...f, sellerId: userId, quantityAvailable: f.quantityTotal, status: 'draft',
          });
          const listingId = identifiers[0].id as string;
          await this.history(m, listingId, null, 'draft', userId, 'created');
          return listingId;
        })
        .catch(fromDatabase);
    });
    return { listing: await this.view(id, { userId }), repeated };
  }

  /** FR-LST-07: a draft changes freely; an active listing only its text (and price and quantity) until locked. */
  async update(userId: string, id: string, dto: UpdateListingDto) {
    await this.db
      .transaction(async (m) => {
        const l = await this.lockOwn(m, id, userId);
        const sent = Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined);
        if (l.status === 'active') {
          if (l.lockedAt) throw new Problem('listing-locked');
          const fixed = sent.filter((k) => !ACTIVE_EDITABLE.has(k) || (l.saleFormat === 'auction' && (k === 'price' || k === 'quantity')));
          if (fixed.length) throw new Problem('listing-state', { errors: fixed.map((field) => ({ field, reason: 'fixed-after-publication' })) });
        } else if (l.status !== 'draft') {
          throw new Problem('listing-state');
        }
        const f = fieldsOf(l);
        if (dto.categoryId !== undefined) f.categoryId = dto.categoryId;
        if (dto.title !== undefined) f.title = dto.title.trim();
        if (dto.description !== undefined) f.description = dto.description.trim();
        if (dto.condition !== undefined) f.condition = dto.condition;
        if (dto.noVisibleDefects !== undefined) f.noVisibleDefects = dto.noVisibleDefects;
        if (dto.fulfilmentOptions !== undefined) f.fulfilmentOptions = dto.fulfilmentOptions;
        if (dto.weightClass !== undefined) f.weightClass = dto.weightClass;
        if (dto.sizeClass !== undefined) f.sizeClass = dto.sizeClass;
        if (dto.price !== undefined) f.price = dto.price;
        if (dto.quantity !== undefined) f.quantityTotal = dto.quantity;
        if (dto.area !== undefined) [f.areaDistrict, f.approxLat, f.approxLng] = [dto.area.district.trim(), round3(dto.area.lat), round3(dto.area.lng)];
        const errors = fieldErrors(f, await m.getRepository(Category).findOneBy({ id: f.categoryId }));
        if (errors.length) throw new Problem('validation-failed', { errors });
        // unlocked: nothing is reserved or sold yet, so every unit is available
        await m.getRepository(Listing).update({ id }, { ...f, quantityAvailable: f.quantityTotal - l.quantityReserved - l.quantitySold });
      })
      .catch(fromDatabase);
    return this.view(id, { userId });
  }

  // ---------------------------------------------------------------- photos (section 6.2)

  async addPhoto(userId: string, id: string, bytes: Buffer | undefined, showsDefects: boolean) {
    if (!bytes) throw new Problem('photo-rejected', { errors: [{ field: 'photo', reason: 'required' }] });
    const cp33 = (await this.params.current()).get<{ image_bytes: number; photos: number }>('CP-33');
    // a cheap check first, so no image is decoded for a listing that cannot take it
    await this.db.transaction(async (m) => this.assertPhotosEditable(await this.lockOwn(m, id, userId)));
    let stored;
    try {
      stored = await this.media.store(bytes, cp33.image_bytes);
    } catch (err) {
      if (err instanceof PhotoRejected) throw new Problem('photo-rejected', { errors: [{ field: 'photo', reason: err.reason }] });
      throw err;
    }
    try {
      const photo = await this.db.transaction(async (m) => {
        this.assertPhotosEditable(await this.lockOwn(m, id, userId));
        const all = await m.getRepository(ListingPhoto).findBy({ listingId: id });
        const taken = new Set(all.filter((p) => p.removedAt === null).map((p) => p.position));
        if (taken.size >= Math.min(cp33.photos, 10)) throw new Problem('photo-limit');
        const position = [...Array(10).keys()].map((i) => i + 1).find((p) => !taken.has(p))!;
        const { identifiers } = await m.getRepository(ListingPhoto).insert({
          listingId: id, position, storageKey: stored.key, width: stored.width, height: stored.height, showsDefects,
        });
        return { id: identifiers[0].id as string, position };
      });
      return { ...photo, url: photoUrl(stored.key), thumbUrl: photoUrl(stored.key, 'thumb'), width: stored.width, height: stored.height, showsDefects };
    } catch (err) {
      await this.media.remove(stored.key);
      throw err;
    }
  }

  async removePhoto(userId: string, id: string, photoId: string): Promise<void> {
    const key = await this.db.transaction(async (m) => {
      const l = await this.lockOwn(m, id, userId);
      this.assertPhotosEditable(l);
      const photos = await m.getRepository(ListingPhoto).findBy({ listingId: id });
      const live = photos.filter((p) => p.removedAt === null);
      const photo = live.find((p) => p.id === photoId);
      if (!photo) throw new Problem('not-found');
      const rest = live.filter((p) => p !== photo);
      // an active physical listing keeps what publication required (FR-LST-02)
      if (l.status === 'active' && l.itemKind === 'physical') {
        if (rest.length < 2) throw new Problem('listing-state', { errors: [{ field: 'photos', reason: 'two-needed' }] });
        if (!l.noVisibleDefects && !rest.some((p) => p.showsDefects)) throw new Problem('listing-state', { errors: [{ field: 'photos', reason: 'defect-photo-needed' }] });
      }
      await m.getRepository(ListingPhoto).update({ id: photoId }, { removedAt: new Date() });
      return photo.storageKey;
    });
    await this.media.remove(key);
  }

  /** The file behind a photo shown on a listing; removed photos are no longer served. */
  async photoFile(key: string, size: PhotoSize): Promise<string> {
    if (!STORAGE_KEY.test(key)) throw new Problem('not-found');
    const photo = await this.db.getRepository(ListingPhoto).findOneBy({ storageKey: key });
    if (!photo || photo.removedAt !== null) throw new Problem('not-found');
    return this.media.path(key, size);
  }

  // ---------------------------------------------------------------- publication (FR-LST-09, 11, 12)

  async publish(userId: string, id: string, dto: PublishListingDto) {
    const params = await this.params.current();
    await this.db
      .transaction(async (m) => {
        // two parallel publications by one seller cannot both slip under the listing limit (CP-28)
        await m.query(`SELECT pg_advisory_xact_lock(hashtextextended('listings.publish:' || $1, 0))`, [userId]);
        const l = await this.lockOwn(m, id, userId);
        if (l.status !== 'draft') throw new Problem('listing-state');
        if (l.itemKind === 'game_account' && params.get<boolean>('CP-36') !== true) throw new Problem('feature-off'); // I-30

        const errors: FieldError[] = [];
        const durations = params.get<string[]>('CP-07');
        if (l.saleFormat === 'auction') {
          if (!dto.startPrice) errors.push({ field: 'startPrice', reason: 'required' });
          if (!dto.duration || !durations.includes(dto.duration)) errors.push({ field: 'duration', reason: 'one-of-cp-07' });
          if (dto.startPrice && dto.reservePrice && BigInt(dto.reservePrice) < BigInt(dto.startPrice)) errors.push({ field: 'reservePrice', reason: 'below-start-price' });
        } else {
          for (const k of ['startPrice', 'reservePrice', 'duration'] as const) if (dto[k] !== undefined) errors.push({ field: k, reason: 'auctions-only' });
        }
        if (l.itemKind === 'physical') {
          const live = (await m.getRepository(ListingPhoto).findBy({ listingId: id })).filter((p) => p.removedAt === null);
          if (live.length < 2) errors.push({ field: 'photos', reason: 'two-needed' });
          if (!l.noVisibleDefects && !live.some((p) => p.showsDefects)) errors.push({ field: 'photos', reason: 'defect-photo-or-declaration' });
        }
        if (errors.length) throw new Problem('listing-not-publishable', { errors });

        // FR-LST-09: the seller's active listings against CP-28 (Pro status from Unit 2 arrives with ProStatusQuery)
        const [{ n }] = await m.query(`SELECT count(*)::int AS n FROM listings.listings WHERE seller_id = $1 AND status = 'active'`, [userId]);
        if (n >= params.get<{ standard: number }>('CP-28').standard) throw new Problem('listing-limit');

        const matches = await this.screening.matches(m, l.title, l.description);
        const held = matches.length > 0 || l.itemKind === 'game_account';
        const to: ListingStatus = held ? 'pending_review' : 'active';
        const now = new Date();
        await m.getRepository(Listing).update({ id }, { status: to, publishedAt: held ? null : now });
        const reason = matches.length
          ? `held for review: screening terms ${matches.map((t) => `"${t.term}" (${t.severity})`).join(', ')}`
          : l.itemKind === 'game_account' ? 'held for review: game-account ownership approval' : 'published';
        await this.history(m, id, 'draft', to, userId, reason);

        if (l.saleFormat === 'auction') {
          // the rules are copied from the current parameter version (FR-OPS-08); a held auction's clock
          // restarts when it is approved (U3-08), and it takes no bids before (auctions.place_bid)
          const cp08 = params.get<{ bps: number; min_poisha: number }>('CP-08');
          const cp09 = params.get<{ window: string; extension: string }>('CP-09');
          await m.query(
            `INSERT INTO auctions.auctions (listing_id, seller_id, start_price, reserve_price, inc_bps, inc_min, snipe_window,
                                            snipe_extension, starts_at, original_end_at, end_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::interval, $8::interval, now(), now() + $9::interval, now() + $9::interval)`,
            [id, userId, dto.startPrice, dto.reservePrice ?? null, cp08.bps, cp08.min_poisha, cp09.window, cp09.extension, dto.duration],
          );
        }
        if (!held) await publish(m, 'listings.listing.published', id, { listingId: id, sellerId: userId, itemKind: l.itemKind, saleFormat: l.saleFormat });
      })
      .catch(fromDatabase);
    return this.view(id, { userId });
  }

  // ---------------------------------------------------------------- after publication (FR-LST-07, FR-LST-08)

  async clarify(userId: string, id: string, body: string) {
    const text = body.trim();
    if (text.length === 0) throw new Problem('validation-failed', { errors: [{ field: 'body', reason: 'empty' }] });
    return this.db.transaction(async (m) => {
      const l = await this.lockOwn(m, id, userId);
      if (l.status !== 'active') throw new Problem('listing-state');
      const { identifiers } = await m.getRepository(Clarification).insert({ listingId: id, body: text });
      const c = await m.getRepository(Clarification).findOneByOrFail({ id: identifiers[0].id as string });
      return { id: c.id, body: c.body, at: c.createdAt.toISOString() };
    });
  }

  /** A draft is discarded; an active listing is cancelled while no order holds a unit, an auction while it has no bids. */
  async cancel(userId: string, id: string) {
    await this.db.transaction(async (m) => {
      const l = await this.lockOwn(m, id, userId);
      const from = l.status;
      if (from === 'active') {
        if (l.saleFormat === 'fixed_price' && l.quantityReserved > 0) throw new Problem('listing-state', { errors: [{ field: 'listing', reason: 'order-in-progress' }] });
        if (l.saleFormat === 'auction') {
          const a = await m.getRepository(Auction).findOne({ where: { listingId: id }, lock: { mode: 'pessimistic_write' } });
          if (a && a.bidCount > 0) throw new Problem('listing-state', { errors: [{ field: 'listing', reason: 'auction-has-bids' }] }); // operators only (U3-08)
          if (a) await m.getRepository(Auction).update({ listingId: id }, { status: 'cancelled', closedAt: new Date() });
        }
      } else if (from !== 'draft') {
        throw new Problem('listing-state');
      }
      await m.getRepository(Listing).update({ id }, { status: 'cancelled' });
      await this.history(m, id, from, 'cancelled', userId, from === 'draft' ? 'discarded by the seller' : 'cancelled by the seller');
      if (from === 'active') await publish(m, 'listings.listing.cancelled', id, { listingId: id, sellerId: userId, itemKind: l.itemKind }); // I-30
    });
    return this.view(id, { userId });
  }

  // ---------------------------------------------------------------- reading

  /**
   * Who may see a listing: others see only active, sold and ended listings of visible sellers (FR-SRC-04), and
   * while CP-36 is off no active game-account listing (I-30); the seller sees their own in every state.
   * Anything else is not-found, as for an unknown id. Also the bid engine's "listing is visible" check (U3-04).
   */
  async visible(id: string, viewerId: string | undefined): Promise<Listing> {
    const l = await this.db.getRepository(Listing).findOneBy({ id });
    if (!l) throw new Problem('not-found');
    if (viewerId === l.sellerId) return l;
    if (!PUBLIC_STATUSES.includes(l.status) || !l.sellerVisible) throw new Problem('not-found');
    if (l.itemKind === 'game_account' && l.status === 'active' && (await this.params.current()).get<boolean>('CP-36') !== true) throw new Problem('not-found');
    return l;
  }

  /**
   * The listing page, under visible()'s rule. Never in the public view: the exact or approximate coordinates,
   * the reserve amount, units reserved.
   */
  async view(id: string, viewer: Principal | { userId: string } | undefined) {
    const viewerId = viewer && 'type' in viewer ? userOf(viewer) : viewer?.userId;
    const l = await this.visible(id, viewerId);
    const own = viewerId === l.sellerId;
    const [category, photos, clarifications, auction, state, seller] = await Promise.all([
      this.db.getRepository(Category).findOneByOrFail({ id: l.categoryId }),
      this.db.getRepository(ListingPhoto).find({ where: { listingId: id }, order: { position: 'ASC' } }),
      this.db.getRepository(Clarification).find({ where: { listingId: id }, order: { createdAt: 'ASC', id: 'ASC' } }),
      l.saleFormat === 'auction' ? this.db.getRepository(Auction).findOneBy({ listingId: id }) : Promise.resolve(null),
      l.saleFormat === 'auction' ? readAuctionState(this.db, id) : Promise.resolve(null),
      this.identity.getPublicProfile(l.sellerId),
    ]);
    return {
      id: l.id,
      itemKind: l.itemKind,
      saleFormat: l.saleFormat,
      status: l.status,
      category: { id: category.id, slug: category.slug, nameEn: category.nameEn, nameBn: category.nameBn },
      title: l.title,
      description: l.description,
      condition: l.condition,
      noVisibleDefects: l.noVisibleDefects,
      fulfilmentOptions: l.fulfilmentOptions,
      weightClass: l.weightClass,
      sizeClass: l.sizeClass,
      district: l.areaDistrict, // FR-LST-06: only the district is shown
      price: l.price,
      quantity: { total: l.quantityTotal, available: l.quantityAvailable },
      currentlyReserved: l.quantityAvailable === 0 && l.quantityReserved > 0,
      locked: l.lockedAt !== null,
      photos: photos
        .filter((p) => p.removedAt === null)
        .map((p) => ({ id: p.id, position: p.position, url: photoUrl(p.storageKey), thumbUrl: photoUrl(p.storageKey, 'thumb'), width: p.width, height: p.height, showsDefects: p.showsDefects })),
      clarifications: clarifications.map((c) => ({ id: c.id, body: c.body, at: c.createdAt.toISOString() })),
      // the public state of GET /auctions/{id}/state (U3-04), currentPrice kept for U3-02's readers; serverTime
      // is the database's clock, which also decides bids (FR-AUC-01, AS-2)
      auction: auction && state && {
        ...state,
        currentPrice: state.price,
        ...(own ? { reservePrice: auction.reservePrice } : {}),
      },
      seller: { id: seller.id, displayName: seller.displayName, verified: seller.verified, joinMonth: seller.joinMonth },
      publishedAt: l.publishedAt?.toISOString() ?? null,
      createdAt: l.createdAt.toISOString(),
      ...(own
        ? {
            own: {
              area: l.areaDistrict && { district: l.areaDistrict, lat: Number(l.approxLat), lng: Number(l.approxLng) },
              quantityReserved: l.quantityReserved,
              quantitySold: l.quantitySold,
              sellerVisible: l.sellerVisible,
              updatedAt: l.updatedAt.toISOString(),
            },
          }
        : {}),
    };
  }

  /** The seller's own listings, newest first, in pages of 50 (cursor = the last item's creation time and id). */
  async mine(userId: string, status: ListingStatus | undefined, cursor: string | undefined) {
    const after = decodeCursor(cursor);
    const rows: Record<string, unknown>[] = await this.db.query(
      `SELECT l.id, l.title, l.status, l.item_kind, l.sale_format, l.price, l.quantity_total, l.quantity_available, l.created_at, l.published_at, ${cursorAt('l.created_at')} AS cursor_at,
              (SELECT p.storage_key FROM listings.listing_photos p WHERE p.listing_id = l.id AND p.removed_at IS NULL ORDER BY p.position LIMIT 1) AS photo_key
       FROM listings.listings l
       WHERE l.seller_id = $1 AND ($2::listings.status IS NULL OR l.status = $2)
         AND ($3::timestamptz IS NULL OR (l.created_at, l.id) < ($3::timestamptz, $4::uuid))
       ORDER BY l.created_at DESC, l.id DESC LIMIT ${PAGE + 1}`,
      [userId, status ?? null, after?.at ?? null, after?.id ?? null],
    );
    const page = rows.slice(0, PAGE);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({
        id: r.id, title: r.title, status: r.status, itemKind: r.item_kind, saleFormat: r.sale_format, price: r.price,
        quantity: { total: r.quantity_total, available: r.quantity_available },
        thumbUrl: r.photo_key ? photoUrl(r.photo_key as string, 'thumb') : null,
        createdAt: (r.created_at as Date).toISOString(), publishedAt: (r.published_at as Date | null)?.toISOString() ?? null,
      })),
      nextCursor: rows.length > PAGE && last ? encodeCursor(last.cursor_at as string, last.id as string) : null,
    };
  }

  // ---------------------------------------------------------------- helpers

  /** The listing, locked; another user's listing is "not found" (SEC-SDL-09: no hint that it exists). */
  private async lockOwn(m: EntityManager, id: string, userId: string): Promise<Listing> {
    const l = await m.getRepository(Listing).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!l || l.sellerId !== userId) throw new Problem('not-found');
    return l;
  }

  private assertPhotosEditable(l: Listing) {
    if (l.status === 'active' && l.lockedAt) throw new Problem('listing-locked');
    if (l.status !== 'draft' && l.status !== 'active') throw new Problem('listing-state');
  }

  private history(m: EntityManager, listingId: string, from: ListingStatus | null, to: ListingStatus, userId: string, reason: string) {
    return m.getRepository(ListingStatusChange).insert({ listingId, fromStatus: from, toStatus: to, actorType: 'user', actorId: userId, reason });
  }
}
