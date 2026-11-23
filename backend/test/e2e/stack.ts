// The backend for the web client's end-to-end runs (U8-11; docs/design/08_frontend.pdf section 12): the whole backend
// with the mock providers on a fixed port, and the accounts and objects the runs need, written as the API tests write
// them (test/support). The web server in frontend/e2e/serve.mjs passes /api and /socket.io to it.
//
//   DATABASE_URL=... REDIS_URL=... npx ts-node test/e2e/stack.ts
//
// E2E_API_PORT (default 3100) is the port; E2E_FIXTURES (default ../frontend/e2e/.fixtures.json) receives the
// accounts and ids as JSON. The values are test-only (useTestSecrets): never run this against a real database.
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { seedAreas } from '../../src/areas-seed';
import { MediaPipeline } from '../../src/modules/listings/services/media';
import { requireEnv, useTestSecrets } from '../support/env';
import { openAuction } from '../support/auctions';
import { IdentityFixtures } from '../support/identity';

async function main() {
  requireEnv('DATABASE_URL');
  requireEnv('REDIS_URL');
  useTestSecrets();
  if (process.env.TB_ENV === 'production') throw new Error('the end-to-end stack refuses to run in production');
  process.env.PUBLIC_ORIGIN ??= 'http://localhost:8080';
  process.env.PAYMENT_MODE = 'mock';
  process.env.COURIER_MODE = 'mock';
  process.env.JOB_RUNNER ??= 'off';
  const port = Number(process.env.E2E_API_PORT ?? 3100);
  const out = resolve(process.env.E2E_FIXTURES ?? `${__dirname}/../../../frontend/e2e/.fixtures.json`);
  rmSync(out, { force: true }); // the runs wait for a fresh file

  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true, logger: ['error'] }));
  await app.listen(port, '127.0.0.1');

  // sample photos (renders made for the design, test/e2e/photos), stored as an upload is, so the pages show real images
  const media = app.get(MediaPipeline);
  const photo = (name: 'phone' | 'camera' | 'pad') => media.store(readFileSync(resolve(__dirname, 'photos', `${name}.jpg`)), 10_000_000);

  const ds = await new DataSource({ type: 'postgres', url: requireEnv('DATABASE_URL') }).initialize();
  await seedAreas(ds);
  const fx = await IdentityFixtures.open();
  const buyer = await fx.account({ kyc: 'verified' });
  const seller = await fx.account({ kyc: 'verified' });
  const bidder = await fx.account({ kyc: 'verified' });
  const operator = await fx.staffAccount('operator');
  const operator2 = await fx.staffAccount('operator');
  const administrator = await fx.staffAccount('administrator');
  await fx.query(`UPDATE identity.users SET display_name = $2 WHERE id = $1`, [buyer.userId, 'Rahim Buyer']);
  await fx.query(`UPDATE identity.users SET display_name = $2 WHERE id = $1`, [seller.userId, 'Karim Seller']);
  await fx.query(`UPDATE identity.users SET display_name = $2 WHERE id = $1`, [bidder.userId, 'Shapla Bidder']);

  const [{ id: categoryId }] = await fx.query<{ id: number }>(`SELECT id FROM listings.categories WHERE item_kind = 'physical' ORDER BY id LIMIT 1`);
  const [{ id: listingId }] = await fx.query<{ id: string }>(
    `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
        fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
     VALUES ($1, 'physical', 'fixed_price', $2, 'Samsung Galaxy A15, 128 GB', 'Used for six months, with the box and charger. No scratches.',
        'used', true, 'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, 3, 3) RETURNING id`,
    [seller.userId, categoryId],
  );
  for (const n of [1, 2]) {
    const p = await photo('phone');
    await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, $4, $5)`, [listingId, n, p.key, p.width, p.height]);
  }
  await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);

  // a camera at ৳25,000 for the dispute run: a decision on BDT 20,000 or more needs a second operator (CP-30)
  const [{ id: disputeListingId }] = await fx.query<{ id: string }>(
    `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
        fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
     VALUES ($1, 'physical', 'fixed_price', $2, 'Canon EOS 200D camera with 18-55 lens', 'Bought last year, shutter count low, with bag and charger.',
        'used', true, 'pickup_only', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 2500000, 1, 1) RETURNING id`,
    [seller.userId, categoryId],
  );
  for (const n of [1, 2]) {
    const p = await photo('camera');
    await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, $4, $5)`, [disputeListingId, n, p.key, p.width, p.height]);
  }
  await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [disputeListingId]);

  // a game account at ৳2,500 for the sealed handover run: its game, details and player-ID claim, as Unit 5 leaves an
  // approved listing (FR-GAM-01 to FR-GAM-04)
  const tag = randomUUID().slice(0, 8);
  const [{ id: gameCategory }] = await fx.query<{ id: number }>(
    `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Game accounts', 'গেম অ্যাকাউন্ট', 'game_account') RETURNING id`, [`games-${tag}`],
  );
  const [{ id: gameId }] = await fx.query<{ id: number }>(
    `INSERT INTO game_accounts.games (slug, name, platforms, code_placement, publisher_note) VALUES ($1, 'eFootball', '{android,ios}', 'the bio', 'The publisher may forbid transfers.') RETURNING id`,
    [`efootball-${tag}`],
  );
  const [{ id: gameListingId }] = await fx.query<{ id: string }>(
    `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price, quantity_total, quantity_available)
     VALUES ($1, 'game_account', 'fixed_price', $2, 'eFootball account, division 1', 'A division-1 account with three epic players.', 250000, 1, 1) RETURNING id`,
    [seller.userId, gameCategory],
  );
  const player = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
  await fx.query(`INSERT INTO game_accounts.details (listing_id, seller_id, game_id, platform, player_id, contents) VALUES ($1, $2, $3, 'android', $4, 'Division 1, three epic players.')`, [gameListingId, seller.userId, gameId, player]);
  await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [gameListingId]);
  await fx.query(`INSERT INTO game_accounts.claims (game_id, player_id_norm, listing_id) VALUES ($1, $2, $3)`, [gameId, player, gameListingId]);

  // an auction running for a day from ৳1,000, for the live bidding run
  const auctionId = await openAuction(fx, seller.userId, categoryId, { start: '100000', endsIn: '1 day' });
  for (const { position } of await fx.query<{ position: number }>(`SELECT position FROM listings.listing_photos WHERE listing_id = $1`, [auctionId])) {
    const p = await photo('camera');
    await fx.query(`UPDATE listings.listing_photos SET storage_key = $3, width = $4, height = $5 WHERE listing_id = $1 AND position = $2`, [auctionId, position, p.key, p.width, p.height]);
  }

  // the buyer's order, made through the API as the web client makes it
  const sid = await fx.session({ userId: buyer.userId });
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/orders`, {
    method: 'POST',
    headers: { ...fx.headers(sid, buyer.userId, 'user'), 'content-type': 'application/json', origin: process.env.PUBLIC_ORIGIN, 'idempotency-key': randomUUID() },
    body: JSON.stringify({ listingId, quantity: 1, fulfilment: 'self_pickup' }),
  });
  if (!res.ok) throw new Error(`the seed order was refused: ${res.status} ${await res.text()}`);
  const { id: orderId } = (await res.json()) as { id: unknown };
  // only a well-formed id goes into the file the runs read (an answer from the network is not trusted as is)
  if (typeof orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(orderId)) {
    throw new Error('the seed order came back without a valid id');
  }

  const fixtures = {
    web: process.env.PUBLIC_ORIGIN,
    buyer: { local: buyer.local, password: buyer.password, userId: buyer.userId },
    seller: { local: seller.local, password: seller.password, userId: seller.userId },
    bidder: { local: bidder.local, password: bidder.password, userId: bidder.userId },
    operator: { email: operator.email, password: operator.password, totpSecret: operator.totpSecret },
    operator2: { email: operator2.email, password: operator2.password, totpSecret: operator2.totpSecret },
    administrator: { email: administrator.email, password: administrator.password, totpSecret: administrator.totpSecret },
    listingId, orderId, auctionId, disputeListingId, gameListingId,
  };
  writeFileSync(out, JSON.stringify(fixtures, null, 2));
  await ds.destroy();
  await fx.close();
  console.log(`e2e stack ready on port ${port}; fixtures in ${out}`);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
