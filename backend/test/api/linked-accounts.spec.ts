import { randomInt, randomUUID } from 'crypto';
import { loadConfig } from '../../src/kernel/config/config';
import type { AccountLinkSource } from '../../src/kernel/links/account-links';
import { IDENTITY_ACCOUNT_LINKS } from '../../src/modules/identity/ports';
import { DEVICE_COOKIE } from '../../src/modules/identity/http/session-cookies';
import { AUCTION_QUERY, AuctionQuery } from '../../src/modules/listings/ports';
import { ShillDetector } from '../../src/modules/listings/services/shill-detector.service';
import { ORDERS_ACCOUNT_LINKS } from '../../src/modules/orders/ports';
import { PayoutService } from '../../src/modules/orders/services/payout.service';
import { LinkedAccountsService } from '../../src/modules/trust/services/linked-accounts.service';
import { startApp, TestApp } from '../support/app';
import { openAuction } from '../support/auctions';
import { Browser } from '../support/browser';
import { IdentityFixtures } from '../support/identity';
import { randomPhone } from '../support/phones';

// U7-09: linked accounts (FR-TNS-08) and the relisting flag after a disputed sale (FR-TNS-02), on the running backend
// (docs/design/07_disputes_trust_staff.pdf sections 6.2 and 8; 03_listings_auctions.pdf sections 5.8 and 5.9).
describe('linked accounts', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let category: number;
  let devices: AccountLinkSource;
  let payouts: AccountLinkSource;

  beforeAll(async () => {
    process.env.OUTBOX_DISPATCHER = 'off'; // events are read from the outbox, not delivered
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    devices = t.app.get(IDENTITY_ACCOUNT_LINKS);
    payouts = t.app.get(ORDERS_ACCOUNT_LINKS);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Lamps', 'বাতি', 'physical') RETURNING id`,
      [`links-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    delete process.env.OUTBOX_DISPATCHER;
    await fx?.close();
    await t?.close();
  });

  const signIn = (b: Browser, login: string, password: string) => b.post('/auth/signin', { login, password });
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[]) => (await fx.query<T>(sql, p))[0];
  const newDevices = async (userId: string) =>
    (await fx.query(`SELECT 1 FROM identity.outbox WHERE event_type = 'identity.signin.new_device' AND aggregate_id = $1`, [userId])).length;
  const bank = (routingNumber: string, accountNumber: string) =>
    ({ kind: 'bank' as const, bankName: 'Dutch-Bangla Bank', routingNumber, accountName: 'Rahim Uddin', accountNumber });
  /**
   * A bank payout account, then retired: these users have no KYC submission, and a bank account waiting for review
   * would stop the operators' list of pending accounts in other tests. A replaced account still links.
   */
  const bankAccount = async (userId: string, routingNumber: string, accountNumber: string) => {
    await t.app.get(PayoutService).setAccount(userId, bank(routingNumber, accountNumber));
    await fx.query(`UPDATE payments.payout_accounts SET status = 'replaced', replaced_at = now() WHERE user_id = $1 AND status = 'pending_review'`, [userId]);
  };
  const linkSignals = async (userId: string) =>
    fx.query<{ source_ref: string; subject_user: string; detail: Record<string, unknown> }>(
      `SELECT source_ref, subject_user, detail FROM trust.signals WHERE kind = 'linked_accounts' AND source_ref LIKE '%' || $1 || '%' ORDER BY source_ref`, [userId]);

  async function member() {
    const userId = await fx.user({ kyc: 'verified' });
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method, headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, call };
  }

  it('FR-TNS-08 a browser keeps one device key for every account signed in on it, so the accounts are linked', async () => {
    const [a, b, c] = [await fx.account(), await fx.account(), await fx.account()];
    const shared = new Browser(t, origin);
    expect((await signIn(shared, a.phone, a.password)).status).toBe(204);
    const key = shared.cookies.get(DEVICE_COOKIE);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await shared.post('/auth/signout');
    const r = await signIn(shared, b.phone, b.password);
    expect(r.status).toBe(204);
    expect(r.headers.getSetCookie().some((s) => s.startsWith(`${DEVICE_COOKIE}=`))).toBe(false); // the key is kept
    expect(await newDevices(b.userId)).toBe(1); // still a new device for this account (FR-NTF-06)
    expect((await signIn(new Browser(t, origin), c.phone, c.password)).status).toBe(204);

    expect(await devices.linkedTo(a.userId, [b.userId, c.userId])).toEqual([{ userId: b.userId, via: 'device' }]);
    expect(await devices.linkedTo(b.userId, [a.userId])).toEqual([{ userId: a.userId, via: 'device' }]);
    expect((await devices.pairs()).filter((p) => [p.userId, p.linkedTo].includes(a.userId)))
      .toEqual([{ via: 'device', userId: b.userId, linkedTo: a.userId, at: expect.any(Date) }]);

    // a malformed key is not taken over: the browser gets a new one
    const odd = new Browser(t, origin);
    odd.cookies.set(DEVICE_COOKIE, 'short');
    expect((await signIn(odd, c.phone, c.password)).status).toBe(204);
    expect(odd.cookies.get(DEVICE_COOKIE)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('FR-TNS-08 accounts paid out to the same bank account (blind index) or wallet number are linked', async () => {
    const [a, b, c] = [await fx.user({ kyc: 'verified' }), await fx.user({ kyc: 'verified' }), await fx.user({ kyc: 'verified' })];
    const number = String(randomInt(1e9, 1e10));
    await bankAccount(a, '090271234', number);
    await bankAccount(b, '090275555', number); // the same bank, another branch's routing number
    await bankAccount(c, '125271234', number); // the same number at another bank
    const rows = await fx.query<{ user_id: string; bidx: Buffer }>(
      `SELECT user_id, account_number_bidx AS bidx FROM payments.payout_accounts WHERE user_id = ANY($1)`, [[a, b, c]]);
    expect(rows.every((r) => r.bidx.length === 32 && !r.bidx.toString('latin1').includes(number))).toBe(true);
    expect(await payouts.linkedTo(a, [b, c])).toEqual([{ userId: b, via: 'payout_bank' }]);

    const wallet = randomPhone();
    const d = await fx.user({ kyc: 'verified' });
    for (const u of [c, d]) {
      await fx.query(`UPDATE payments.payout_accounts SET status = 'replaced', replaced_at = now() WHERE user_id = $1 AND status <> 'replaced'`, [u]);
      await fx.query(`INSERT INTO payments.payout_accounts (user_id, kind, wallet_e164, status, effective_at) VALUES ($1, 'bkash_wallet', $2, 'active', now())`, [u, wallet]);
    }
    expect(await payouts.linkedTo(d, [a, b, c])).toEqual([{ userId: c, via: 'payout_wallet' }]);
    const pairs = (await payouts.pairs()).filter((p) => [a, b, c, d].includes(p.userId));
    expect(pairs.map((p) => [p.via, p.userId, p.linkedTo])).toEqual([['payout_bank', b, a], ['payout_wallet', d, c]]);
  });

  it('FR-TNS-08 the daily check raises one signal per linked pair and kind, about the later account, once', async () => {
    const [a, b] = [await fx.user({ kyc: 'verified' }), await fx.user({ kyc: 'verified' })];
    const number = String(randomInt(1e9, 1e10));
    await bankAccount(a, '090271234', number);
    await bankAccount(b, '090271234', number);
    const check = t.app.get(LinkedAccountsService);
    expect(await check.check()).toBeGreaterThanOrEqual(1);
    const [lo, hi] = [a, b].sort();
    expect(await linkSignals(a)).toEqual([{
      source_ref: `payout_bank:${lo}:${hi}`, subject_user: b,
      detail: { via: 'payout_bank', userId: b, linkedTo: a, since: expect.any(String) },
    }]);
    await check.check();
    expect(await linkSignals(a)).toHaveLength(1);
  });

  it('FR-TNS-08 FR-AUC-18 a bidder linked to the seller is flagged on the auction (linked_to_seller)', async () => {
    const [seller, linked, plain] = [await member(), await member(), await member()];
    const number = String(randomInt(1e9, 1e10));
    await bankAccount(seller.userId, '090271234', number);
    await bankAccount(linked.userId, '090271234', number);
    const id = await openAuction(fx, seller.userId, category);
    for (const [m, max] of [[plain, '120000'], [linked, '150000']] as const) {
      expect((await m.call('POST', `/auctions/${id}/bids`, { maximum: max })).status).toBe(201);
    }
    const detector = t.app.get(ShillDetector);
    expect(await detector.scan(id)).toBe(1);
    const flags = await t.app.get<AuctionQuery>(AUCTION_QUERY).getFlags(id);
    expect(flags).toEqual([expect.objectContaining({ kind: 'linked_to_seller', score: 0.7, detail: { bidders: [{ alias: expect.any(Number), bidderId: linked.userId }], via: { [linked.userId]: ['payout_bank'] } } })]);
    expect(JSON.stringify(flags)).not.toContain(plain.userId);
    expect(await detector.scan(id)).toBe(0); // once per auction

    const other = await openAuction(fx, seller.userId, category);
    expect((await plain.call('POST', `/auctions/${other}/bids`, { maximum: '120000' })).status).toBe(201);
    expect(await detector.scan(other)).toBe(0);
  });

  it('FR-TNS-02 DV-22 publishing an item like one sold and disputed in the last 7 days is flagged; publication goes on', async () => {
    const [seller, buyer] = [await member(), await fx.user({ kyc: 'verified' })];
    const listing = async (title: string, status: 'draft' | 'sold') => {
      const [{ id }] = await fx.query<{ id: string }>(
        `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
            fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
         VALUES ($1, 'physical', 'fixed_price', $2, $3, 'A brass desk lamp, written by the linked-accounts test.', 'used', true,
            'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, 1, 1) RETURNING id`,
        [seller.userId, category, title],
      );
      for (const n of [1, 2]) await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
      if (status === 'sold') {
        await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() - interval '3 days' WHERE id = $1`, [id]);
        await fx.query(`UPDATE listings.listings SET status = 'sold', quantity_available = 0, quantity_sold = 1 WHERE id = $1`, [id]);
      }
      return id;
    };
    const sold = await listing('Antique brass desk lamp with green shade', 'sold');
    const order = async () => (await fx.query<{ id: string }>(
      `INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total,
          listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status)
       VALUES ('fixed_price', $1, 'physical', $2, $3, 1, 1500000, 1500000, 'self_pickup', 0, 1500000, '{"title":"Antique brass desk lamp"}', 500, 1000, 1,
               now() + interval '1 hour', 'awaiting_payment') RETURNING id`,
      [sold, buyer, seller.userId],
    ))[0].id;
    const dispute = (orderId: string, daysAgo: number) => fx.query(
      `INSERT INTO disputes.disputes (order_id, buyer_id, seller_id, item_kind, type, description, item_price, amount_collected, opened_at, seller_due_at)
       VALUES ($1, $2, $3, 'physical', 'not_as_described', 'The lamp does not work at all.', 1500000, 1500000,
               now() - make_interval(days => $4), now() - make_interval(days => $4) + interval '2 days')`,
      [orderId, buyer, seller.userId, daysAgo]);
    const flagOf = async (id: string) =>
      (await fx.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM auctions.outbox WHERE event_type = 'listings.listing.relisting_flagged' AND aggregate_id = $1`, [id]))
        .map((r) => r.payload);

    // no dispute, or one older than DV-22: not flagged
    const relist = await listing('Antique brass desk lamp, green shade', 'draft');
    expect((await seller.call('POST', `/listings/${relist}/publish`, {})).status).toBe(200);
    await dispute(await order(), 8);
    const late = await listing('Antique brass desk lamp, green glass shade', 'draft');
    expect((await seller.call('POST', `/listings/${late}/publish`, {})).status).toBe(200);
    expect([...(await flagOf(relist)), ...(await flagOf(late))]).toEqual([]);

    await dispute(await order(), 1);
    const again = await listing('Antique brass desk lamp with a green shade', 'draft');
    expect((await seller.call('POST', `/listings/${again}/publish`, {})).status).toBe(200);
    expect(await flagOf(again)).toEqual([{ listingId: again, sellerId: seller.userId, previousListingId: sold, reason: 'disputed', similarity: expect.any(Number) }]);
    expect(await one(`SELECT status FROM listings.listings WHERE id = $1`, [again])).toEqual({ status: 'active' });
  });
});
