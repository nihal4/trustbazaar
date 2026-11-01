import { randomUUID } from 'crypto';
import type { IdentityFixtures } from './identity';

// An active auction listing for the auction tests (U3-04, U3-05), published as the database allows it: a draft,
// two photos (listings.check_publishable), then active; the auction row as ListingService.publish writes it, with
// CP-08 at 2 % and at least BDT 50, as in the design's worked example. Times are relative to the database's now().
export interface AuctionOptions {
  start?: string;
  reserve?: string;
  endsIn?: string;
  startedAgo?: string;
  window?: string;
  extension?: string;
}

export async function openAuction(fx: IdentityFixtures, sellerId: string, categoryId: number, o: AuctionOptions = {}): Promise<string> {
  const [{ id }] = await fx.query<{ id: string }>(
    `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
                                    fulfilment_options, area_district, approx_lat, approx_lng, status, published_at)
     VALUES ($1, 'physical', 'auction', $2, 'Old film camera', 'A working film camera with its leather case.', 'used', true,
             'pickup_only', 'Dhaka', 23.81, 90.41, 'draft', null) RETURNING id`,
    [sellerId, categoryId],
  );
  for (const position of [1, 2]) {
    await fx.query(
      `INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`,
      [id, position, randomUUID().replace(/-/g, '')],
    );
  }
  await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
  await fx.query(
    `INSERT INTO auctions.auctions (listing_id, seller_id, start_price, reserve_price, inc_bps, inc_min, snipe_window, snipe_extension,
                                    starts_at, original_end_at, end_at)
     VALUES ($1, $2, $3, $4, 200, 5000, $5::interval, $6::interval, now() - $7::interval, now() + $8::interval, now() + $8::interval)`,
    [id, sellerId, o.start ?? '100000', o.reserve ?? null, o.window ?? '2 minutes', o.extension ?? '2 minutes', o.startedAgo ?? '1 minute', o.endsIn ?? '1 day'],
  );
  return id;
}

/** Moves an auction's end into the past, beyond the close grace (DV-17), as if its time had run out. */
export async function endAuction(fx: IdentityFixtures, auctionId: string, ago = '3 seconds'): Promise<void> {
  await fx.query(
    `UPDATE auctions.auctions SET starts_at = least(starts_at, now() - interval '1 hour'),
            original_end_at = now() - $2::interval, end_at = now() - $2::interval WHERE listing_id = $1`,
    [auctionId, ago],
  );
}
