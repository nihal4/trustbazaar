/* TrustBazaar demo data, for a LOCAL demonstration only. Never run it on a real deployment.
 *
 * Run it inside the backend container, after `docker compose up --build -d` has finished:
 *   docker compose exec -T backend node - < demo-seed.js
 *
 * It creates (and on a second run reuses):
 *   - delivery areas (the project's own areas-seed command) and a few public meetup points in Dhaka;
 *   - product categories;
 *   - five user accounts, verified and ready: two buyers, two sellers, one new user without identity verification;
 *   - two staff accounts (administrator, operator);
 *   - listings with photos, posted by the sellers through the real API: fixed-price items and live auctions;
 *   - a few bids (one buyer outbids the other) and chats between buyers and sellers;
 *   - orders through the real checkout and the simulated payment page: two paid orders (money in escrow)
 *     and one order waiting for payment, so the order pages, escrow and notifications have data.
 * At the end it prints every login and password.
 *
 * It refuses to run unless TB_ENV is development or test.
 */
'use strict';
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const argon2 = require('argon2');
const sharp = require('sharp');

const API = 'http://127.0.0.1:3000/api/v1';
const ORIGIN = process.env.PUBLIC_ORIGIN || 'http://localhost:8080';
const ARGON2 = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const USERS = [
  { key: 'buyer1', name: 'Rahim Ahmed', phone: '+8801700000001', email: 'buyer@trustbazaar.test', password: 'Buyer-Test-2026!', role: 'Buyer', kyc: 'verified', lat: 23.746, lng: 90.376 },
  { key: 'seller1', name: 'Karim Hossain', phone: '+8801700000002', email: 'seller@trustbazaar.test', password: 'Seller-Test-2026!', role: 'Seller', kyc: 'verified', lat: 23.751, lng: 90.381 },
  { key: 'buyer2', name: 'Nadia Islam', phone: '+8801700000003', email: 'buyer2@trustbazaar.test', password: 'Buyer2-Demo-2026!', role: 'Second buyer (to outbid)', kyc: 'verified', lat: 23.874, lng: 90.398 },
  { key: 'seller2', name: 'Fatema Begum', phone: '+8801700000004', email: 'seller2@trustbazaar.test', password: 'Seller2-Demo-2026!', role: 'Second seller', kyc: 'verified', lat: 23.807, lng: 90.368 },
  { key: 'newuser', name: 'Sabbir Rahman', phone: '+8801700000005', email: 'newuser@trustbazaar.test', password: 'Newuser-Demo-2026!', role: 'New user (identity not verified yet)', kyc: 'unsubmitted', lat: 23.780, lng: 90.410 },
];
const STAFF = [
  { role: 'administrator', name: 'Demo Administrator', email: 'admin@trustbazaar.test', password: 'Admin-Demo-2026!x' },
  { role: 'operator', name: 'Demo Operator', email: 'operator@trustbazaar.test', password: 'Operator-Demo-2026!' },
];
const CATEGORIES = [
  ['mobile-phones', 'Mobile phones', 'মোবাইল ফোন'],
  ['laptops-computers', 'Laptops and computers', 'ল্যাপটপ ও কম্পিউটার'],
  ['electronics', 'Electronics', 'ইলেকট্রনিক্স'],
  ['fashion', 'Fashion', 'ফ্যাশন'],
  ['home-furniture', 'Home and furniture', 'ঘর ও আসবাব'],
  ['books', 'Books', 'বই'],
  ['sports', 'Sports and fitness', 'খেলাধুলা ও ফিটনেস'],
];
const POINTS = [
  ['police_station', 'Dhanmondi Police Station', 'ধানমন্ডি থানা', 23.7465, 90.3760, 'Front gate, next to the duty desk'],
  ['shopping_mall', 'Bashundhara City Shopping Complex', 'বসুন্ধরা সিটি শপিং কমপ্লেক্স', 23.7509, 90.3907, 'Main entrance, ground floor information desk'],
  ['shopping_mall', 'Jamuna Future Park', 'যমুনা ফিউচার পার্ক', 23.8133, 90.4243, 'Gate 1, beside the security post'],
  ['police_station', 'Mirpur Model Police Station', 'মিরপুর মডেল থানা', 23.8069, 90.3687, 'Visitors\' area by the front gate'],
  ['bank_branch', 'Sonali Bank, Uttara branch', 'সোনালী ব্যাংক, উত্তরা শাখা', 23.8759, 90.3795, 'Inside the guarded entrance, during banking hours'],
  ['shopping_mall', 'Police Plaza Concord, Gulshan', 'পুলিশ প্লাজা কনকর্ড, গুলশান', 23.7735, 90.4152, 'Ground floor food court entrance'],
];
// price in taka (fixed price) or starting price in taka (auction)
const LISTINGS = [
  { seller: 'seller1', cat: 'mobile-phones', format: 'fixed_price', title: 'Google Pixel 7, 128 GB, Snow', price: 35000, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'phone', color: ['#dfe3ea', '#5b7db1'],
    desc: 'Used for one year, always in a case. Battery health 91%. Comes with the original box and charger. No scratches on the screen.' },
  { seller: 'seller1', cat: 'mobile-phones', format: 'auction', title: 'Samsung Galaxy S21, 256 GB, Phantom Grey', price: 20000, duration: '72 hours', cond: 'used', ok: false, ful: 'pickup_only', w: 'up_to_1kg', s: 'small', shape: 'phone', color: ['#52575f', '#20242a'],
    desc: 'The screen has no scratches. There is a small mark on the back corner, shown in the second photo. Unlocked, works with every operator.' },
  { seller: 'seller1', cat: 'laptops-computers', format: 'fixed_price', title: 'Lenovo ThinkPad T480, Core i5, 16 GB RAM, 512 GB SSD', price: 42000, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_2kg', s: 'medium', shape: 'laptop', color: ['#2b2d31', '#6b7280'],
    desc: 'Office laptop in good condition. New battery fitted three months ago. Windows 11 installed. Charger included.' },
  { seller: 'seller1', cat: 'electronics', format: 'auction', title: 'Sony WH-1000XM4 noise-cancelling headphones', price: 12000, duration: '72 hours', cond: 'like_new', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'headphones', color: ['#1f2937', '#9ca3af'],
    desc: 'Bought last year, used only a few times. Comes with the carrying case, cable and the original box.' },
  { seller: 'seller1', cat: 'books', format: 'fixed_price', title: 'HSC Physics and Chemistry book set (6 books)', price: 1200, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_5kg', s: 'medium', shape: 'books', color: ['#b45309', '#1e3a8a'],
    desc: 'Complete set for HSC science, some pencil notes inside. Good for revision. Collect from Dhanmondi or get it by courier.' },
  { seller: 'seller2', cat: 'home-furniture', format: 'fixed_price', title: 'Wooden study table with drawer', price: 6500, cond: 'used', ok: true, ful: 'pickup_only', w: 'over_10kg', s: 'oversize', shape: 'table', color: ['#92400e', '#78350f'],
    desc: 'Solid wood study table, 120 cm wide, one drawer. Very sturdy. Pickup only from Mirpur because of its size.' },
  { seller: 'seller2', cat: 'fashion', format: 'fixed_price', title: 'Jamdani saree, red and gold, unused', price: 8500, cond: 'new', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'cloth', color: ['#b91c1c', '#d97706'],
    desc: 'Handwoven Jamdani saree, never worn, bought for a wedding. The colour is exactly as in the photos.' },
  { seller: 'seller2', cat: 'sports', format: 'auction', title: 'Mountain bicycle, 26 inch, 21 gears', price: 9000, duration: '72 hours', cond: 'used', ok: false, ful: 'pickup_only', w: 'over_10kg', s: 'oversize', shape: 'bicycle', color: ['#047857', '#111827'],
    desc: 'Rides well, gears recently serviced. The paint has some scratches on the frame, shown in the photos. Pickup from Mirpur.' },
  { seller: 'seller2', cat: 'electronics', format: 'fixed_price', title: 'Walton 32 inch LED TV with remote', price: 11000, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_10kg', s: 'large', shape: 'tv', color: ['#111827', '#374151'],
    desc: 'Works perfectly, moving house so selling. Comes with the wall mount and the remote control.' },
  { seller: 'seller2', cat: 'mobile-phones', format: 'auction', title: 'iPhone 11, 64 GB, Black', price: 25000, duration: '72 hours', cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'phone', color: ['#111111', '#444444'],
    desc: 'Battery health 84%. Face ID works. Small scratches on the frame only. Sold with a new cover.' },
  { seller: 'seller2', cat: 'laptops-computers', format: 'fixed_price', title: 'Dell 24 inch monitor, Full HD, HDMI', price: 9500, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_5kg', s: 'medium', shape: 'tv', color: ['#1f2937', '#0ea5e9'],
    desc: 'Bought for a home office and used lightly. No dead pixels. HDMI cable and stand included.' },
  { seller: 'seller1', cat: 'books', format: 'fixed_price', title: 'Bangla literature collection, 12 novels', price: 2400, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_5kg', s: 'medium', shape: 'books', color: ['#7c2d12', '#065f46'],
    desc: 'Twelve well-kept novels by well-known Bangla authors. Covers are intact; a few have names written inside.' },
  { seller: 'seller1', cat: 'electronics', format: 'fixed_price', title: 'Canon EOS 1500D camera with 18-55 mm lens', price: 28000, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_2kg', s: 'medium', shape: 'headphones', color: ['#1f2937', '#6b7280'],
    desc: 'About 6,000 shots. Comes with the lens, battery, charger and a bag. Works perfectly; a small scuff on the grip.' },
  { seller: 'seller2', cat: 'mobile-phones', format: 'fixed_price', title: 'Xiaomi Redmi Note 12, 128 GB, Blue', price: 15500, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'phone', color: ['#3b82f6', '#1e3a8a'],
    desc: 'Eight months old, with a screen protector and a case. Battery lasts a full day. Box and charger included.' },
  { seller: 'seller1', cat: 'laptops-computers', format: 'fixed_price', title: 'Apple iPad 9th generation, 64 GB, Wi-Fi', price: 38000, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'tv', color: ['#9ca3af', '#e5e7eb'],
    desc: 'Used for study only. No scratches on the glass. Comes with the original charger and cable.' },
  { seller: 'seller2', cat: 'electronics', format: 'fixed_price', title: 'JBL Flip 5 Bluetooth speaker, waterproof', price: 7500, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'headphones', color: ['#b91c1c', '#111827'],
    desc: 'Loud and clear sound, battery holds about ten hours. Small mark on the fabric. Cable included.' },
  { seller: 'seller2', cat: 'mobile-phones', format: 'fixed_price', title: 'OnePlus Nord CE 3, 128 GB, Grey', price: 21000, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'phone', color: ['#6b7280', '#111827'],
    desc: 'Six months old, always in a case. Fast charger and box included. Battery health 94%.' },
  { seller: 'seller2', cat: 'electronics', format: 'fixed_price', title: 'Bose SoundLink Flex speaker, black', price: 9800, cond: 'like_new', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'headphones', color: ['#111827', '#4b5563'],
    desc: 'Barely used, comes with the cable and the box. Waterproof and loud.' },
  { seller: 'seller1', cat: 'electronics', format: 'fixed_price', title: 'Sony Alpha a6000 camera with 16-50 mm lens', price: 46000, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_2kg', s: 'medium', shape: 'headphones', color: ['#1f2937', '#9ca3af'],
    desc: 'About 9,000 shots. Two batteries, a charger and a bag. Works perfectly.' },
  { seller: 'seller2', cat: 'laptops-computers', format: 'fixed_price', title: 'HP Pavilion 15 laptop, Ryzen 5, 8 GB, 512 GB SSD', price: 52000, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_2kg', s: 'medium', shape: 'laptop', color: ['#9ca3af', '#374151'],
    desc: 'A year old. Battery gives about five hours. No dents. Original charger included.' },
  { seller: 'seller1', cat: 'electronics', format: 'fixed_price', title: 'Logitech MX Master 3 wireless mouse', price: 6500, cond: 'used', ok: true, ful: 'pickup_or_courier', w: 'up_to_1kg', s: 'small', shape: 'headphones', color: ['#374151', '#9ca3af'],
    desc: 'Used for a year, all buttons work, receiver and cable included.' },
];

if (!['development', 'test'].includes(process.env.TB_ENV || 'development')) {
  console.error('Refusing to run: TB_ENV is not development or test. This script is for local demonstrations only.');
  process.exit(1);
}

// ------------------------------------------------------------------ demonstration photos (no real products)
function photoSvg(shape, [a, b], variant) {
  const bg = variant ? '#eef0f4' : '#f7f4ee';
  const body = {
    phone: `<rect x="430" y="110" width="340" height="680" rx="48" fill="${a}"/><rect x="452" y="160" width="296" height="580" rx="20" fill="${b}"/>`,
    laptop: `<rect x="300" y="200" width="600" height="380" rx="20" fill="${a}"/><rect x="330" y="230" width="540" height="320" rx="8" fill="${b}"/><path d="M220 600 h760 l-60 70 h-640 z" fill="${a}"/>`,
    headphones: `<path d="M400 520 a200 200 0 0 1 400 0" fill="none" stroke="${a}" stroke-width="44"/><rect x="350" y="480" width="110" height="200" rx="40" fill="${b}"/><rect x="740" y="480" width="110" height="200" rx="40" fill="${b}"/>`,
    books: `<rect x="330" y="300" width="120" height="420" fill="${a}"/><rect x="460" y="260" width="110" height="460" fill="${b}"/><rect x="580" y="320" width="130" height="400" fill="${a}"/><rect x="720" y="280" width="120" height="440" fill="${b}"/>`,
    table: `<rect x="260" y="330" width="680" height="60" fill="${a}"/><rect x="290" y="390" width="40" height="330" fill="${b}"/><rect x="870" y="390" width="40" height="330" fill="${b}"/><rect x="620" y="390" width="220" height="110" fill="${b}"/>`,
    cloth: `<path d="M360 220 L600 160 L840 220 L800 760 L400 760 Z" fill="${a}"/><path d="M380 640 L820 640 L810 700 L390 700 Z" fill="${b}"/>`,
    bicycle: `<circle cx="400" cy="560" r="150" fill="none" stroke="${b}" stroke-width="22"/><circle cx="800" cy="560" r="150" fill="none" stroke="${b}" stroke-width="22"/><path d="M400 560 L540 360 L720 360 L800 560 M540 360 L620 560 L720 360" fill="none" stroke="${a}" stroke-width="26"/>`,
    tv: `<rect x="230" y="220" width="740" height="440" rx="14" fill="${a}"/><rect x="255" y="245" width="690" height="390" fill="${b}"/><rect x="560" y="660" width="80" height="60" fill="${a}"/><rect x="460" y="720" width="280" height="24" rx="10" fill="${a}"/>`,
  }[shape];
  const tilt = variant ? 'rotate(-8 600 450)' : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="1200" height="900" fill="${bg}"/><ellipse cx="600" cy="800" rx="380" ry="40" fill="#00000014"/><g transform="${tilt}">${body}</g></svg>`);
}
const photo = (l, variant) => sharp(photoSvg(l.shape, l.color, variant)).jpeg({ quality: 86 }).toBuffer();

// ------------------------------------------------------------------ the API, as a browser would call it
class Session {
  constructor() { this.cookies = new Map(); }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async call(method, path, body, extra = {}) {
    const headers = { origin: ORIGIN, cookie: this.header(), 'x-csrf-token': this.cookies.get('__Host-tb_csrf') || '', ...extra };
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const r = await fetch(API + path, { method, headers, body: payload });
    for (const c of r.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (/max-age=0/i.test(c) || value === '') this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!r.ok) {
      const err = new Error(`${method} ${path} answered ${r.status}: ${text.slice(0, 300)}`);
      err.status = r.status; err.body = json;
      throw err;
    }
    return json;
  }
}
async function signIn(u) {
  const s = new Session();
  await s.call('POST', '/auth/signin', { login: u.email, password: u.password });
  await s.call('GET', '/me');
  return s;
}

// ------------------------------------------------------------------ the run
(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const say = (m) => console.log(`- ${m}`);

  // 1. delivery areas, with the project's own command
  const areas = spawnSync('node', ['dist/areas-seed.js'], { encoding: 'utf8' });
  say(`delivery areas: ${(areas.stdout || areas.stderr).trim().split('\n').pop()}`);

  // 2. categories
  for (const [i, [slug, en, bn]] of CATEGORIES.entries()) {
    await q(`INSERT INTO listings.categories (slug, name_en, name_bn, item_kind, sort_order) VALUES ($1, $2, $3, 'physical', $4) ON CONFLICT (slug) DO NOTHING`, [slug, en, bn, i + 1]);
  }
  const cats = Object.fromEntries((await q(`SELECT slug, id FROM listings.categories WHERE slug = ANY($1)`, [CATEGORIES.map((c) => c[0])])).map((r) => [r.slug, r.id]));
  say(`categories: ${Object.keys(cats).length}`);

  // 3. users (verified phone and e-mail, adult confirmed; KYC as listed)
  for (const u of USERS) {
    const hash = await argon2.hash(u.password, ARGON2);
    const [row] = await q(
      `INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, email_verified_at, password_hash, password_single_factor_ok,
                                   adult_confirmed_at, kyc_status, account_status, area_district, approx_lat, approx_lng)
       VALUES ($1, $2, now(), $3, now(), $4, true, now(), $5, 'active', 'Dhaka', $6, $7)
       ON CONFLICT DO NOTHING RETURNING id`, [u.name, u.phone, u.email, hash, u.kyc, u.lat, u.lng]);
    const [found] = await q(`SELECT id FROM identity.users WHERE phone_e164 = $1`, [u.phone]);
    u.id = found.id;
    if (row && u.kyc === 'verified') {
      await q(`INSERT INTO identity.kyc_status_history (user_id, from_status, to_status, actor_type, at) VALUES ($1, 'pending_review', 'verified', 'system', now() - interval '31 days')`, [u.id]);
    }
  }
  say(`users: ${USERS.length}`);

  // 4. staff: the first administrator (if none exists yet) creates the operator
  let [admin] = await q(`SELECT id, email FROM identity.staff_accounts WHERE role = 'administrator' ORDER BY created_at LIMIT 1`);
  for (const st of STAFF) {
    const [exists] = await q(`SELECT id FROM identity.staff_accounts WHERE email = $1`, [st.email]);
    if (exists) { st.id = exists.id; st.existing = true; continue; }
    if (st.role === 'administrator' && admin) { st.skipped = admin.email; continue; }
    const hash = await argon2.hash(st.password, ARGON2);
    const [r] = await q(`INSERT INTO identity.staff_accounts (email, display_name, role, status, password_hash, created_by) VALUES ($1, $2, $3, 'pending_mfa', $4, $5) RETURNING id`,
      [st.email, st.name, st.role, hash, st.role === 'administrator' ? null : admin.id]);
    st.id = r.id;
    if (st.role === 'administrator') admin = { id: r.id, email: st.email };
  }
  say('staff: administrator and operator');

  // 5. public meetup points (curated by the administrator)
  const [{ n: pointCount }] = await q(`SELECT count(*)::int AS n FROM delivery.meetup_points WHERE active AND district = 'Dhaka'`);
  if (pointCount < 3) {
    for (const [kind, en, bn, lat, lng, guidance] of POINTS) {
      await q(`INSERT INTO delivery.meetup_points (kind, name_en, name_bn, district, lat, lng, guidance, added_by) VALUES ($1, $2, $3, 'Dhaka', $4, $5, $6, $7)`, [kind, en, bn, lat, lng, guidance, admin.id]);
    }
  }
  say(`meetup points in Dhaka: ${Math.max(pointCount, POINTS.length)}`);

  // 6. listings, posted by the sellers through the API
  const by = Object.fromEntries(USERS.map((u) => [u.key, u]));
  const sessions = {};
  for (const k of ['seller1', 'seller2', 'buyer1', 'buyer2']) sessions[k] = await signIn(by[k]);
  let posted = 0;
  for (const l of LISTINGS) {
    const seller = by[l.seller];
    // any listing of this seller with this title counts, whatever its status (an item sold by the orders step must not be posted again)
    const [existing] = await q(`SELECT id, status FROM listings.listings WHERE seller_id = $1 AND title = $2 ORDER BY (status = 'draft') DESC, created_at DESC LIMIT 1`, [seller.id, l.title]);
    if (existing && existing.status !== 'draft') { l.id = existing.id; continue; }
    const s = sessions[l.seller];
    const created = existing ? { id: existing.id } : await s.call('POST', '/listings', {
      itemKind: 'physical', saleFormat: l.format, categoryId: cats[l.cat], title: l.title, description: l.desc, condition: l.cond,
      noVisibleDefects: l.ok, fulfilmentOptions: l.ful, weightClass: l.w, sizeClass: l.s, quantity: 1,
      ...(l.format === 'fixed_price' ? { price: String(l.price * 100) } : {}),
      area: { district: 'Dhaka', lat: seller.lat, lng: seller.lng },
    });
    l.id = created.id;
    const [{ n: photos }] = await q(`SELECT count(*)::int AS n FROM listings.listing_photos WHERE listing_id = $1`, [l.id]);
    for (let i = photos; i < 2; i++) {
      const form = new FormData();
      form.append('photo', new Blob([await photo(l, i === 1)], { type: 'image/jpeg' }), `photo-${i + 1}.jpg`);
      form.append('showsDefects', String(!l.ok && i === 1));
      await s.call('POST', `/listings/${l.id}/photos`, form);
    }
    await s.call('POST', `/listings/${l.id}/publish`, l.format === 'auction' ? { startPrice: String(l.price * 100), duration: l.duration } : {});
    posted++;
  }
  say(`listings: ${posted} posted now, ${LISTINGS.length} in total`);

  // 7. bids: Rahim bids on two auctions, Nadia outbids him on one
  const bid = async (who, l, taka) => {
    try {
      await sessions[who].call('POST', `/auctions/${l.id}/bids`, { maximum: String(taka * 100) }, { 'idempotency-key': randomUUID() });
    } catch (e) { if (e.status !== 422) throw e; } // already leading, or below the minimum on a re-run
  };
  const auctions = LISTINGS.filter((l) => l.format === 'auction');
  const [{ n: bids }] = await q(`SELECT count(*)::int AS n FROM auctions.bids WHERE auction_id = ANY($1)`, [auctions.map((l) => l.id)]);
  if (bids === 0) {
    await bid('buyer1', auctions[0], 22000); // Galaxy S21: a 22,000 maximum, the price stays at 20,000
    await bid('buyer1', auctions[3], 27000); // iPhone 11
    await bid('buyer2', auctions[3], 30000); // Nadia outbids Rahim on the iPhone
  }
  say('bids placed on the Galaxy S21 and the iPhone 11');

  // 8. a chat between Rahim (buyer) and Karim (seller) about the Pixel 7
  const pixel = LISTINGS[0];
  const thread = await sessions.buyer1.call('POST', `/listings/${pixel.id}/threads`);
  const threadId = thread.id ?? thread.threadId;
  const [{ n: msgs }] = await q(`SELECT count(*)::int AS n FROM chat.messages WHERE thread_id = $1`, [threadId]);
  if (msgs === 0) {
    await sessions.buyer1.call('POST', `/threads/${threadId}/messages`, { clientId: randomUUID(), text: 'Hi, is the Pixel 7 still available? Is the battery still good?' });
    await sessions.seller1.call('POST', `/threads/${threadId}/messages`, { clientId: randomUUID(), text: 'Yes, it is available. Battery health is 91%, I can show you at the meetup.' });
    await sessions.buyer1.call('POST', `/threads/${threadId}/messages`, { clientId: randomUUID(), text: 'Great. Can we meet at Dhanmondi Police Station on Saturday afternoon?' });
  }
  say('chat: Rahim and Karim about the Pixel 7');

  // 9. a second chat: Nadia asks Fatema about the monitor
  const monitor = LISTINGS.find((l) => l.title.startsWith('Dell 24'));
  const thread2 = await sessions.buyer2.call('POST', `/listings/${monitor.id}/threads`);
  const thread2Id = thread2.id ?? thread2.threadId;
  const [{ n: msgs2 }] = await q(`SELECT count(*)::int AS n FROM chat.messages WHERE thread_id = $1`, [thread2Id]);
  if (msgs2 === 0) {
    await sessions.buyer2.call('POST', `/threads/${thread2Id}/messages`, { clientId: randomUUID(), text: 'Assalamu alaikum, does the monitor have any dead pixels? Can I see it before paying?' });
    await sessions.seller2.call('POST', `/threads/${thread2Id}/messages`, { clientId: randomUUID(), text: 'Walaikum assalam. No dead pixels at all. Yes, we can meet at Mirpur Model Police Station.' });
  }
  say('chat: Nadia and Fatema about the monitor');

  // 10. orders through the real checkout, paid on the simulated provider page (no money moves)
  const SELF = 'http://127.0.0.1:3000';
  const asLocal = (u) => { const x = new URL(u, SELF); return SELF + x.pathname + x.search; };
  const pay = async (s, orderId) => {
    const attempt = await s.call('POST', `/orders/${orderId}/payments`, { provider: 'bkash' }, { 'idempotency-key': randomUUID() });
    const decided = await fetch(asLocal(attempt.redirectUrl), { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'outcome=succeeded' });
    if (decided.status !== 303) throw new Error(`the mock payment page answered ${decided.status}`);
    const back = await fetch(asLocal(decided.headers.get('location')), { redirect: 'manual' }); // the callback: the server asks the provider
    if (back.status >= 400) throw new Error(`the payment callback answered ${back.status}`);
  };
  const orderFor = async (buyerKey, listing, mode) => {
    const [found] = await q(`SELECT id FROM orders.orders WHERE buyer_id = $1 AND listing_id = $2 LIMIT 1`, [by[buyerKey].id, listing.id]);
    if (found) return `kept (already ordered)`;
    try {
      const order = await sessions[buyerKey].call('POST', '/orders', { listingId: listing.id, quantity: 1, fulfilment: 'self_pickup' }, { 'idempotency-key': randomUUID() });
      if (mode === 'paid') await pay(sessions[buyerKey], order.id);
      return mode === 'paid' ? 'paid, money held in escrow' : 'created, waiting for payment';
    } catch (e) { return `skipped (${e.message.slice(0, 160)})`; }
  };
  const byTitle = (t) => LISTINGS.find((l) => l.title.startsWith(t));
  say(`order: Rahim buys the Pixel 7: ${await orderFor('buyer1', byTitle('Google Pixel 7'), 'paid')}`);
  say(`order: Nadia buys the HSC books: ${await orderFor('buyer2', byTitle('HSC Physics'), 'paid')}`);
  say(`order: Rahim reserves the Jamdani saree: ${await orderFor('buyer1', byTitle('Jamdani saree'), 'pending')}`);
  // 11. scenarios for the terms and the dispute screens (courier terms, dispute terms with a video, an open dispute with evidence)
  const TINY_MP4 = Buffer.from('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', 'base64'); // a 2-second test video, for the demonstration only
  const sellerCall = { seller1: sessions.seller1, seller2: sessions.seller2 };
  const ensureOrder = async (buyerKey, listing, body, mode) => {
    const [found] = await q(`SELECT id FROM orders.orders WHERE buyer_id = $1 AND listing_id = $2 LIMIT 1`, [by[buyerKey].id, listing.id]);
    if (found) return { id: found.id, fresh: false };
    const order = await sessions[buyerKey].call('POST', '/orders', { listingId: listing.id, quantity: 1, ...body }, { 'idempotency-key': randomUUID() });
    if (mode === 'paid') await pay(sessions[buyerKey], order.id);
    return { id: order.id, fresh: true };
  };
  const step = async (label, fn) => { try { say(`${label}: ${await fn()}`); } catch (e) { say(`${label}: skipped (${e.message.slice(0, 200)})`); } };
  let courierOrder, pickupOrder, disputeOrder, courierChoiceOrder;

  // a. courier terms before choosing: an order with no way of getting the item chosen yet
  await step('scenario A (courier terms): Rahim reserves the Xiaomi phone, courier not chosen yet', async () => {
    const o = await ensureOrder('buyer1', byTitle('Xiaomi Redmi'), {}, 'pending');
    courierChoiceOrder = o.id;
    return o.fresh ? 'created' : 'kept';
  });

  // b. a courier order, paid: Rahim buys the ThinkPad with a binding quote
  await step('scenario B (courier, paid): Rahim buys the JBL speaker by courier', async () => {
    const l = byTitle('JBL Flip');
    const [found] = await q(`SELECT id FROM orders.orders WHERE buyer_id = $1 AND listing_id = $2 LIMIT 1`, [by.buyer1.id, l.id]);
    if (found) { courierOrder = found.id; return 'kept'; }
    const [area] = await q(`SELECT id FROM delivery.areas ORDER BY id LIMIT 1`);
    const addr = await sessions.buyer1.call('POST', '/me/addresses', { kind: 'dropoff', label: 'Home', areaId: Number(area.id), line1: 'House 12, Road 5, Dhanmondi', contactName: 'Rahim Ahmed' });
    const quote = await sessions.buyer1.call('POST', '/delivery/quotes', { listingId: l.id, quantity: 1, addressId: addr.id });
    const order = await sessions.buyer1.call('POST', '/orders', { listingId: l.id, quantity: 1 }, { 'idempotency-key': randomUUID() });
    await sessions.buyer1.call('PUT', `/orders/${order.id}/fulfilment`, { fulfilment: 'courier', quoteId: quote.id });
    await pay(sessions.buyer1, order.id);
    courierOrder = order.id;
    return 'paid, courier chosen';
  });

  // c/d. two orders handed over in person (the seller enters the buyer's code): the buyer may now open a dispute
  const handedOver = async (buyerKey, sellerKey, listing) => {
    const o = await ensureOrder(buyerKey, listing, { fulfilment: 'self_pickup' }, 'paid');
    const [h] = await q(`SELECT status FROM delivery.handovers WHERE order_id = $1`, [o.id]).catch(() => [null]);
    if (h && h.status === 'completed') return o.id;
    let view = null;
    for (let i = 0; i < 10 && !(view && view.code); i++) { // the handover is created a moment after the payment
      try { view = await sessions[buyerKey].call('GET', `/orders/${o.id}/handover`); } catch { /* not there yet */ }
      if (!(view && view.code)) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!view || !view.code) throw new Error('no handover code');
    await sellerCall[sellerKey].call('POST', `/orders/${o.id}/handover-code`, { code: view.code });
    return o.id;
  };
  await step('scenario C (dispute terms and video): Rahim buys the camera and the seller hands it over', async () => {
    pickupOrder = await handedOver('buyer1', 'seller1', byTitle('Canon EOS 1500D'));
    return 'delivered; open the order and choose Open a dispute';
  });
  await step('scenario D (an open hidden-fault dispute after a meetup, with a photo and a video): Nadia buys the iPad and disputes it', async () => {
    disputeOrder = await handedOver('buyer2', 'seller1', byTitle('Apple iPad'));
    const [have] = await q(`SELECT id FROM disputes.disputes WHERE order_id = $1 LIMIT 1`, [disputeOrder]);
    if (have) return 'kept';
    const { disputeId } = await sessions.buyer2.call('POST', `/orders/${disputeOrder}/disputes`, { type: 'not_as_described', description: 'The listing said the iPad had no faults. A service centre report (photo attached) shows a replaced, non-genuine battery and a screen fault that cannot be seen when it is switched off. A video of the fault is attached.' }, { 'idempotency-key': randomUUID() });
    const photoForm = new FormData();
    photoForm.append('file', new Blob([await photo(byTitle('Apple iPad'), true)], { type: 'image/jpeg' }), 'screen.jpg');
    await sessions.buyer2.call('POST', `/disputes/${disputeId}/evidence`, photoForm);
    const videoForm = new FormData();
    videoForm.append('file', new Blob([TINY_MP4], { type: 'video/mp4' }), 'screen.mp4');
    await sessions.buyer2.call('POST', `/disputes/${disputeId}/evidence`, videoForm);
    return 'dispute opened with a photo and a video';
  });

  // 12. round two: more scenarios in fresh states (a pending order, a paid courier order, a handed-over order with no dispute, and two open disputes)
  let e2, f2, g2, h2, i2;
  await step('scenario E (courier terms before choosing): Nadia reserves the OnePlus phone', async () => { const o = await ensureOrder('buyer2', byTitle('OnePlus Nord'), {}, 'pending'); e2 = o.id; return o.fresh ? 'created' : 'kept'; });
  await step('scenario F (courier, paid): Nadia buys the Bose speaker by courier', async () => {
    const l = byTitle('Bose SoundLink');
    const [found] = await q(`SELECT id FROM orders.orders WHERE buyer_id = $1 AND listing_id = $2 LIMIT 1`, [by.buyer2.id, l.id]);
    if (found) { f2 = found.id; return 'kept'; }
    const [area] = await q(`SELECT id FROM delivery.areas ORDER BY id OFFSET 3 LIMIT 1`);
    const addr = await sessions.buyer2.call('POST', '/me/addresses', { kind: 'dropoff', label: 'Office', areaId: Number(area.id), line1: 'Flat 4B, Road 11, Uttara', contactName: 'Nadia Islam' });
    const quote = await sessions.buyer2.call('POST', '/delivery/quotes', { listingId: l.id, quantity: 1, addressId: addr.id });
    const order = await sessions.buyer2.call('POST', '/orders', { listingId: l.id, quantity: 1 }, { 'idempotency-key': randomUUID() });
    await sessions.buyer2.call('PUT', `/orders/${order.id}/fulfilment`, { fulfilment: 'courier', quoteId: quote.id });
    await pay(sessions.buyer2, order.id);
    f2 = order.id;
    return 'paid, courier chosen';
  });
  await step('scenario G (handed over, no dispute yet): Nadia buys the Sony camera', async () => { g2 = await handedOver('buyer2', 'seller1', byTitle('Sony Alpha')); return 'delivered'; });
  const openDispute = async (buyerKey, orderId, listing, text) => {
    const [have] = await q(`SELECT id FROM disputes.disputes WHERE order_id = $1 LIMIT 1`, [orderId]);
    if (have) return have.id;
    const { disputeId } = await sessions[buyerKey].call('POST', `/orders/${orderId}/disputes`, { type: 'not_as_described', description: text }, { 'idempotency-key': randomUUID() });
    const pf = new FormData();
    pf.append('file', new Blob([await photo(listing, true)], { type: 'image/jpeg' }), 'report.jpg');
    await sessions[buyerKey].call('POST', `/disputes/${disputeId}/evidence`, pf);
    const vf = new FormData();
    vf.append('file', new Blob([TINY_MP4], { type: 'video/mp4' }), 'fault.mp4');
    await sessions[buyerKey].call('POST', `/disputes/${disputeId}/evidence`, vf);
    return disputeId;
  };
  await step('scenario H (dispute waiting for the seller): Rahim disputes the HP laptop', async () => {
    h2 = await handedOver('buyer1', 'seller2', byTitle('HP Pavilion'));
    await openDispute('buyer1', h2, byTitle('HP Pavilion'), 'The listing says battery health is good and about five hours. A service centre report (photo attached) shows a non-genuine battery with a fault that only appears after a few minutes. A video of the shutdown is attached.');
    return 'dispute open, the seller has not answered';
  });
  await step('scenario I (dispute with messages from both sides): Rahim disputes the Logitech mouse', async () => {
    i2 = await handedOver('buyer1', 'seller1', byTitle('Logitech MX'));
    const id = await openDispute('buyer1', i2, byTitle('Logitech MX'), 'The listing says all buttons work. The scroll wheel stops working after a few minutes and the service centre says the sensor is not original. Report and video attached.');
    const [msgs] = await q(`SELECT count(*)::int AS n FROM disputes.statements WHERE dispute_id = $1`, [id]);
    if (msgs.n === 0) {
      await sessions.seller1.call('POST', `/disputes/${id}/statements`, { text: 'I sold it exactly as it was. The sensor is the one it came with and the wheel worked when we tested it together at the meetup.' });
      await sessions.buyer1.call('POST', `/disputes/${id}/statements`, { text: 'It worked for the first minutes at the meetup. The fault appears only after it has been used for a while, as the video shows.' });
      await sessions.seller1.call('POST', `/disputes/${id}/statements`, { text: 'Then please return it and I will check it. I am happy to refund if the sensor was replaced.' });
    }
    return 'under review, three messages';
  });

  const SITE = process.env.DEMO_SITE || 'http://localhost:5173';
  console.log('\nScenario pages (sign in first as the account named):');
  const links = [
    ['Rahim (buyer@trustbazaar.test)', 'courier terms before choosing', courierChoiceOrder],
    ['Rahim (buyer@trustbazaar.test)', 'courier order, paid, with its shipment', courierOrder],
    ['Rahim (buyer@trustbazaar.test)', 'delivered by hand: open a dispute (terms, photos and videos)', pickupOrder],
    ['Nadia (buyer2@trustbazaar.test)', 'a dispute already open, with a photo and a video', disputeOrder],
    ['Karim (seller@trustbazaar.test)', 'the same dispute as the seller (respond with a statement and evidence)', disputeOrder],
  ];
  links.push(
    ['Nadia (buyer2@trustbazaar.test)', 'courier terms before choosing (OnePlus phone)', e2],
    ['Nadia (buyer2@trustbazaar.test)', 'paid courier order with its shipment (Bose speaker)', f2],
    ['Nadia (buyer2@trustbazaar.test)', 'handed over by hand, no dispute yet: open one (Sony camera)', g2],
    ['Rahim (buyer@trustbazaar.test)', 'a dispute waiting for the seller (HP laptop)', h2],
    ['Fatema (seller2@trustbazaar.test)', 'the same dispute as the seller: write the response', h2],
    ['Rahim (buyer@trustbazaar.test)', 'a dispute with messages from both sides (Logitech mouse)', i2],
    ['Karim (seller@trustbazaar.test)', 'the same dispute with messages, as the seller', i2],
  );
  for (const [who, what, id] of links) console.log(`  ${who.padEnd(36)} ${what}\n      ${id ? `${SITE}/orders/${id}` : '(not created, see the messages above)'}`);

  await db.end();

  // ------------------------------------------------------------------ the logins
  console.log('\nTrustBazaar demo accounts (open the site, then Sign in; phone or e-mail both work)\n');
  console.log('Role                                  | Phone        | E-mail                       | Password');
  console.log('--------------------------------------+--------------+------------------------------+--------------------');
  for (const u of USERS) console.log(`${u.role.padEnd(38)}| ${u.phone.replace('+880', '0')}  | ${u.email.padEnd(29)}| ${u.password}`);
  console.log('\nStaff accounts (pending MFA: the staff console arrives with task U8-10)');
  for (const st of STAFF) {
    if (st.skipped) console.log(`${st.role.padEnd(14)}| an administrator already exists: ${st.skipped} (password as printed when it was created)`);
    else console.log(`${st.role.padEnd(14)}| ${st.email.padEnd(29)}| ${st.password}${st.existing ? '   (already existed: password unchanged)' : ''}`);
  }
  console.log('\nPayments, SMS and the courier are simulated in this setup; no real money moves.');
})().catch((e) => {
  console.error(`\nDemo seed stopped: ${e.message}`);
  process.exit(1);
});
