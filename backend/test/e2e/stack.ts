// The backend for the web client's end-to-end runs (U8-11; docs/design/08_frontend.pdf section 12): the whole backend
// with the mock providers on a fixed port, and the accounts and objects the runs need, written as the API tests write
// them (test/support). The web server in frontend/e2e/serve.mjs passes /api and /socket.io to it.
//
//   DATABASE_URL=... REDIS_URL=... npx ts-node test/e2e/stack.ts
//
// E2E_API_PORT (default 3100) is the port; E2E_FIXTURES (default ../frontend/e2e/.fixtures.json) receives the
// accounts and ids as JSON. The values are test-only (useTestSecrets): never run this against a real database.
import { rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { seedAreas } from '../../src/areas-seed';
import { requireEnv, useTestSecrets } from '../support/env';
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

  const ds = await new DataSource({ type: 'postgres', url: requireEnv('DATABASE_URL') }).initialize();
  await seedAreas(ds);
  const fx = await IdentityFixtures.open();
  const buyer = await fx.account({ kyc: 'verified' });
  const seller = await fx.account({ kyc: 'verified' });
  const operator = await fx.staffAccount('operator');
  const administrator = await fx.staffAccount('administrator');
  await fx.query(`UPDATE identity.users SET display_name = $2 WHERE id = $1`, [buyer.userId, 'Rahim Buyer']);
  await fx.query(`UPDATE identity.users SET display_name = $2 WHERE id = $1`, [seller.userId, 'Karim Seller']);

  const [{ id: categoryId }] = await fx.query<{ id: number }>(`SELECT id FROM listings.categories WHERE item_kind = 'physical' ORDER BY id LIMIT 1`);
  const [{ id: listingId }] = await fx.query<{ id: string }>(
    `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
        fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
     VALUES ($1, 'physical', 'fixed_price', $2, 'Samsung Galaxy A15, 128 GB', 'Used for six months, with the box and charger. No scratches.',
        'used', true, 'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, 3, 3) RETURNING id`,
    [seller.userId, categoryId],
  );
  for (const n of [1, 2]) {
    await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [listingId, n, randomUUID().replace(/-/g, '')]);
  }
  await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [listingId]);

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
    operator: { email: operator.email, password: operator.password, totpSecret: operator.totpSecret },
    administrator: { email: administrator.email, password: administrator.password, totpSecret: administrator.totpSecret },
    listingId, orderId,
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
