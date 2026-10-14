-- Tests for the database-enforced rules and the bid engine of Unit 3. Run after the Unit 1, 2
-- and 3 schemas:  psql -v ON_ERROR_STOP=1 -f 03_listings_auctions_tests.sql
-- Each rejection must name the intended rule. Runs in one transaction and rolls back.
-- Note: inside one transaction now() is constant, so every bid here has the same receipt time;
-- ordering is by processing order (bid id), as in production.
BEGIN;
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.expect_fail(label text, stmt text, expect text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF position(expect IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FAIL  % : rejected for the wrong reason: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  % [%]', label, expect;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL  % : statement succeeded but should have been rejected', label;
END $$;
CREATE FUNCTION pg_temp.ok(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond THEN RAISE NOTICE 'PASS  %', label; ELSE RAISE EXCEPTION 'FAIL  %', label; END IF;
END $$;
-- helper: create an active auction listing and its auction row
CREATE FUNCTION pg_temp.new_auction(p_id uuid, p_start bigint, p_reserve bigint, p_end interval) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, condition,
       no_visible_defects, fulfilment_options, area_district, approx_lat, approx_lng)
  VALUES (p_id, 'c0000000-0000-4000-8000-000000000005', 'physical', 'auction', 101, 'Vintage camera',
          'A working film camera with original case and strap.', 'used', true, 'pickup_only', 'Dhaka', 23.810, 90.410);
  INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height)
  VALUES (p_id, 1, 'k-' || p_id || '-1', 800, 600), (p_id, 2, 'k-' || p_id || '-2', 800, 600);
  UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = p_id;
  INSERT INTO auctions.auctions (listing_id, seller_id, start_price, reserve_price, inc_bps, inc_min,
       snipe_window, snipe_extension, starts_at, original_end_at, end_at)
  VALUES (p_id, 'c0000000-0000-4000-8000-000000000005', p_start, p_reserve, 200, 5000,
          interval '2 minutes', interval '2 minutes', now() - interval '3 hours', now() + p_end, now() + p_end);
END $$;

-- ---------------------------------------------------------------- fixtures
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-000000000001', 'Asha',  '+8801711000001', now(), 'a@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000002', 'Babu',  '+8801711000002', now(), 'b@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000003', 'Chaya', '+8801711000003', now(), 'c@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000005', 'Seller','+8801711000005', now(), 's@tb.test', '$argon2id$v=19$x', true, now());
INSERT INTO listings.categories (id, slug, name_en, name_bn, item_kind, prohibited) OVERRIDING SYSTEM VALUE VALUES
 (101, 'cameras', 'Cameras', 'ক্যামেরা', 'physical', false),
 (102, 'game-accounts', 'Game accounts', 'গেম অ্যাকাউন্ট', 'game_account', false),
 (103, 'weapons', 'Weapons', 'অস্ত্র', 'physical', true),
 (104, 'phones', 'Phones', 'মোবাইল ফোন', 'physical', false);

-- ---------------------------------------------------------------- listings
SELECT pg_temp.expect_fail('FR-LST-10 a prohibited category cannot be used',
 $q$INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects, fulfilment_options, area_district, approx_lat, approx_lng, price) VALUES ('c0000000-0000-4000-8000-000000000005','physical','fixed_price',103,'Air rifle','Description long enough to pass.','used',true,'pickup_only','Dhaka',23.8,90.4,100000)$q$,
 'is prohibited');
SELECT pg_temp.expect_fail('category must match the item kind',
 $q$INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, price) VALUES ('c0000000-0000-4000-8000-000000000005','game_account','fixed_price',101,'PUBG account','Level 70 account with many skins.',500000)$q$,
 'does not match item kind');
SELECT pg_temp.expect_fail('a new listing starts as a draft',
 $q$INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects, fulfilment_options, area_district, approx_lat, approx_lng, price, status) VALUES ('c0000000-0000-4000-8000-000000000005','physical','fixed_price',104,'Phone','A phone in good working condition.','used',true,'pickup_only','Dhaka',23.8,90.4,100000,'active')$q$,
 'starts as draft');
SELECT pg_temp.expect_fail('FR-LST-05 an auction has quantity 1',
 $q$INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects, fulfilment_options, area_district, approx_lat, approx_lng, quantity_total, quantity_available) VALUES ('c0000000-0000-4000-8000-000000000005','physical','auction',104,'Two phones','Two phones in good working condition.','used',true,'pickup_only','Dhaka',23.8,90.4,2,2)$q$,
 'auction_single_unit');
SELECT pg_temp.expect_fail('FR-LST-03 courier needs weight and size classes',
 $q$INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects, fulfilment_options, area_district, approx_lat, approx_lng, price) VALUES ('c0000000-0000-4000-8000-000000000005','physical','fixed_price',104,'Phone','A phone in good working condition.','used',true,'pickup_or_courier','Dhaka',23.8,90.4,100000)$q$,
 'courier_needs_parcel');
SELECT pg_temp.expect_fail('a game account has no physical fields',
 $q$INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, price) VALUES ('c0000000-0000-4000-8000-000000000005','game_account','fixed_price',102,'PUBG account','Level 70 account with many skins.','used',500000)$q$,
 'game_fields');

-- a fixed-price phone listing, three units
INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
     fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
VALUES ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000005', 'physical', 'fixed_price', 104,
     'Used Android phone', 'Used phone, small scratch on the back, battery healthy.', 'used', false,
     'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.810, 90.410, 1500000, 3, 3);
INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height)
VALUES ('e0000000-0000-4000-8000-000000000001', 1, 'p-1', 800, 600);
SELECT pg_temp.expect_fail('FR-LST-02 publishing needs at least two photos',
 $q$UPDATE listings.listings SET status='active', published_at=now() WHERE id='e0000000-0000-4000-8000-000000000001'$q$,
 'at least two photos');
INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height)
VALUES ('e0000000-0000-4000-8000-000000000001', 2, 'p-2', 800, 600);
SELECT pg_temp.expect_fail('FR-LST-02 a defect photo or a no-defects declaration is required',
 $q$UPDATE listings.listings SET status='active', published_at=now() WHERE id='e0000000-0000-4000-8000-000000000001'$q$,
 'declare that there are none');
UPDATE listings.listing_photos SET shows_defects = true WHERE storage_key = 'p-2';
UPDATE listings.listings SET status='active', published_at=now() WHERE id='e0000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('a listing with two photos, one showing defects, is published', true);
SELECT pg_temp.expect_fail('FR-LST-01 sale format is fixed after publication',
 $q$UPDATE listings.listings SET sale_format='auction', price=NULL WHERE id='e0000000-0000-4000-8000-000000000001'$q$,
 'fixed after publication');

-- stock (FR-FIX-02/04/05)
SELECT pg_temp.ok('reserve 2 of 3', listings.reserve('e0000000-0000-4000-8000-000000000001', 2));
SELECT pg_temp.ok('reserving 2 more of the 1 left is refused', NOT listings.reserve('e0000000-0000-4000-8000-000000000001', 2));
SELECT pg_temp.ok('reserve the last unit', listings.reserve('e0000000-0000-4000-8000-000000000001', 1));
SELECT pg_temp.ok('searchable view shows the listing as currently reserved',
 (SELECT currently_reserved FROM listings.searchable WHERE id='e0000000-0000-4000-8000-000000000001'));
SELECT listings.release('e0000000-0000-4000-8000-000000000001', 1);
SELECT listings.mark_sold('e0000000-0000-4000-8000-000000000001', 2);
SELECT pg_temp.ok('after a release and a sale: 1 available, 0 reserved, 2 sold, still active',
 (SELECT quantity_available=1 AND quantity_reserved=0 AND quantity_sold=2 AND status='active' FROM listings.listings WHERE id='e0000000-0000-4000-8000-000000000001'));
SELECT listings.reserve('e0000000-0000-4000-8000-000000000001', 1);
SELECT listings.mark_sold('e0000000-0000-4000-8000-000000000001', 1);
SELECT pg_temp.ok('FR-FIX-04 sold when nothing is available or reserved',
 (SELECT status='sold' FROM listings.listings WHERE id='e0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('stock must always add up',
 $q$UPDATE listings.listings SET quantity_sold = 2 WHERE id='e0000000-0000-4000-8000-000000000001'$q$,
 'stock_adds_up');
SELECT pg_temp.expect_fail('FR-LST-07 content is locked after the first order',
 $q$UPDATE listings.listings SET title='A different title' WHERE id='e0000000-0000-4000-8000-000000000001'$q$,
 'locked after the first bid or order');
SELECT pg_temp.expect_fail('FR-LST-12 sold is terminal',
 $q$UPDATE listings.listings SET status='active' WHERE id='e0000000-0000-4000-8000-000000000001'$q$,
 'is not permitted');
INSERT INTO listings.clarifications (listing_id, body) VALUES ('e0000000-0000-4000-8000-000000000001', 'Charger included.');
SELECT pg_temp.expect_fail('clarifications are append-only',
 $q$UPDATE listings.clarifications SET body='edited'$q$, 'append-only');

-- ---------------------------------------------------------------- increments (CP-08)
SELECT pg_temp.ok('increment on BDT 10,000 is 2% = BDT 200', auctions.increment(1000000, 200, 5000) = 20000);
SELECT pg_temp.ok('increment on BDT 1,000 is the BDT 50 minimum', auctions.increment(100000, 200, 5000) = 5000);
SELECT pg_temp.ok('2% is rounded up to a whole taka (BDT 12,345.67 -> BDT 247)', auctions.increment(1234567, 200, 5000) = 24700);

-- ---------------------------------------------------------------- bid engine
SELECT pg_temp.new_auction('e1000000-0000-4000-8000-000000000001', 100000, NULL, interval '2 hours');   -- start BDT 1,000
SELECT pg_temp.ok('first bid leads at the starting price, whatever the maximum',
 (SELECT outcome='leading' AND price=100000 FROM auctions.place_bid('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001',150000)));
SELECT pg_temp.expect_fail('FR-AUC-02 a bid below price + increment is refused',
 $q$SELECT * FROM auctions.place_bid('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',104999)$q$, 'below_minimum');
SELECT pg_temp.ok('FR-AUC-06 the leader''s proxy answers a lower maximum: price = 1,200 + 50',
 (SELECT outcome='outbid' AND price=125000 FROM auctions.place_bid('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',120000)));
SELECT pg_temp.ok('FR-AUC-07 equal maximums: the earlier one wins, at that maximum',
 (SELECT outcome='outbid' AND price=150000 FROM auctions.place_bid('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002',150000)));
SELECT pg_temp.ok('leader is still the first bidder after the tie',
 (SELECT leader_id='c0000000-0000-4000-8000-000000000001' FROM auctions.auctions WHERE listing_id='e1000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('a higher maximum takes the lead at the old maximum + increment (1,500 + 50)',
 (SELECT outcome='leading' AND price=155000 FROM auctions.place_bid('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',200000)));
SELECT pg_temp.expect_fail('a leader can only raise their maximum',
 $q$SELECT * FROM auctions.place_bid('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',180000)$q$, 'max_not_higher');
SELECT pg_temp.ok('raising one''s own maximum does not raise the price',
 (SELECT outcome='raised_own_max' AND price=155000 FROM auctions.place_bid('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',250000)));
SELECT pg_temp.expect_fail('FR-AUC-02 the seller cannot bid',
 $q$SELECT * FROM auctions.place_bid('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000005',300000)$q$, 'seller_cannot_bid');
SELECT pg_temp.ok('FR-AUC-13 consistent masks: bidders are 1, 2, 3 in order of first bid',
 (SELECT array_agg(alias_no ORDER BY bidder_id) = ARRAY[1,2,3] FROM auctions.bidder_aliases WHERE auction_id='e1000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('FR-AUC-08 the public history never shows the leader''s maximum (250,000 or 200,000)',
 (SELECT bool_and(shown_amount NOT IN (200000, 250000)) FROM auctions.replay('e1000000-0000-4000-8000-000000000001') WHERE counted));
SELECT pg_temp.ok('recorded live decisions equal a replay of the same bids',
 (SELECT bool_and(r.price = b.price_after AND r.leader = b.leader_after)
    FROM auctions.replay('e1000000-0000-4000-8000-000000000001') r JOIN auctions.bids b ON b.id = r.bid_id));

-- reserve (FR-AUC-09)
SELECT pg_temp.new_auction('e1000000-0000-4000-8000-000000000002', 100000, 300000, interval '2 hours');
SELECT pg_temp.ok('a maximum above the reserve lifts the price to the reserve',
 (SELECT price=300000 FROM auctions.place_bid('e1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001',500000)));
SELECT pg_temp.ok('"reserve not met" is cleared',
 (SELECT NOT reserve_not_met FROM listings.searchable WHERE id='e1000000-0000-4000-8000-000000000002'));
SELECT pg_temp.new_auction('e1000000-0000-4000-8000-000000000003', 100000, 300000, interval '2 hours');
SELECT 1 FROM auctions.place_bid('e1000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001',200000);
SELECT pg_temp.ok('below the reserve: price stays at the start and "reserve not met" shows',
 (SELECT display_price=100000 AND reserve_not_met FROM listings.searchable WHERE id='e1000000-0000-4000-8000-000000000003'));

-- anti-sniping (FR-AUC-05) and the end time (FR-AUC-04)
SELECT pg_temp.new_auction('e1000000-0000-4000-8000-000000000004', 100000, NULL, interval '60 seconds');
SELECT pg_temp.ok('a bid in the last 2 minutes extends the end to receipt + 2 minutes',
 (SELECT extended AND end_at = now() + interval '2 minutes'
    FROM auctions.place_bid('e1000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000001',100000)));
SELECT pg_temp.ok('the end time only ever moves later',
 (SELECT end_at > original_end_at FROM auctions.auctions WHERE listing_id='e1000000-0000-4000-8000-000000000004'));
SELECT pg_temp.new_auction('e1000000-0000-4000-8000-000000000005', 100000, NULL, interval '2 hours');
UPDATE auctions.auctions SET original_end_at = now() - interval '1 second', end_at = now() - interval '1 second'
 WHERE listing_id='e1000000-0000-4000-8000-000000000005';
SELECT pg_temp.expect_fail('FR-AUC-04 a bid received at or after the end is refused',
 $q$SELECT * FROM auctions.place_bid('e1000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000001',200000)$q$, 'auction_ended');

-- strikes and restrictions (FR-AUC-16)
SELECT pg_temp.ok('one strike does not restrict',
 NOT auctions.record_strike('c0000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001', gen_random_uuid(), 2, interval '90 days', interval '30 days'));
SELECT pg_temp.ok('the second strike in 90 days restricts bidding for 30 days',
 auctions.record_strike('c0000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001', gen_random_uuid(), 2, interval '90 days', interval '30 days'));
SELECT pg_temp.expect_fail('a restricted bidder is refused',
 $q$SELECT * FROM auctions.place_bid('e1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000002',900000)$q$, 'bidder_restricted');
DELETE FROM auctions.bidding_restrictions;

-- bids are binding (FR-AUC-10)
SELECT pg_temp.expect_fail('a bid cannot be changed',
 $q$UPDATE auctions.bids SET max_amount = 1 WHERE auction_id='e1000000-0000-4000-8000-000000000001'$q$, 'can only be voided');
SELECT pg_temp.expect_fail('a bid cannot be deleted',
 $q$DELETE FROM auctions.bids WHERE auction_id='e1000000-0000-4000-8000-000000000001'$q$, 'cannot be deleted');

-- void and recompute: Chaya's bids are voided; Asha leads again at 1,500 (the tie with Babu)
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash) VALUES
 ('a0000000-0000-4000-8000-000000000001', 'op@tb.test', 'Operator', 'operator', 'active', '$argon2id$v=19$x');
UPDATE auctions.bids SET voided_at = now(), voided_by = 'a0000000-0000-4000-8000-000000000001', void_reason = 'account compromised'
 WHERE auction_id='e1000000-0000-4000-8000-000000000001' AND bidder_id='c0000000-0000-4000-8000-000000000003';
SELECT pg_temp.expect_fail('a bid can be voided only once',
 $q$UPDATE auctions.bids SET void_reason='again' WHERE bidder_id='c0000000-0000-4000-8000-000000000003' AND auction_id='e1000000-0000-4000-8000-000000000001'$q$, 'only be voided, once');
SELECT auctions.recompute('e1000000-0000-4000-8000-000000000001');
SELECT pg_temp.ok('FR-AUC-10 after the void the auction is as if those bids never happened',
 (SELECT leader_id='c0000000-0000-4000-8000-000000000001' AND current_price=150000 AND leader_max=150000 AND bid_count=3
    FROM auctions.auctions WHERE listing_id='e1000000-0000-4000-8000-000000000001'));

-- close (FR-AUC-09/14) with the grace period
SELECT pg_temp.ok('not closed before end + grace',
 auctions.close_if_due('e1000000-0000-4000-8000-000000000001', interval '2 seconds') = 'open');
UPDATE auctions.auctions SET original_end_at = now() - interval '10 seconds', end_at = now() - interval '10 seconds'
 WHERE listing_id IN ('e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000003');
SELECT pg_temp.ok('the due auction closes as awarded',
 auctions.close_if_due('e1000000-0000-4000-8000-000000000001', interval '2 seconds') = 'awarded');
SELECT pg_temp.ok('awarded to the leader at the current price',
 (SELECT winner_id='c0000000-0000-4000-8000-000000000001' AND final_price=150000 FROM auctions.auctions WHERE listing_id='e1000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('FR-AUC-09 reserve not met closes unsold',
 auctions.close_if_due('e1000000-0000-4000-8000-000000000003', interval '2 seconds') = 'unsold');
SELECT pg_temp.ok('closing again changes nothing',
 auctions.close_if_due('e1000000-0000-4000-8000-000000000001', interval '2 seconds') = 'awarded');
SELECT pg_temp.expect_fail('an award below the reserve is impossible',
 $q$UPDATE auctions.auctions SET status='awarded', winner_id='c0000000-0000-4000-8000-000000000001', final_price=100000 WHERE listing_id='e1000000-0000-4000-8000-000000000003'$q$,
 'award_meets_reserve');

-- second chance (FR-AUC-15): Babu, at his highest maximum, then nobody (Chaya's bids are voided)
SELECT pg_temp.ok('the next eligible bidder is Babu at BDT 1,500',
 (SELECT bidder='c0000000-0000-4000-8000-000000000002' AND price=150000 FROM auctions.next_second_chance('e1000000-0000-4000-8000-000000000001')));
INSERT INTO auctions.second_chance_offers (auction_id, bidder_id, price, expires_at)
VALUES ('e1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 150000, now() + interval '24 hours');
SELECT pg_temp.ok('no further eligible bidder after Babu has been offered',
 (SELECT bidder IS NULL FROM auctions.next_second_chance('e1000000-0000-4000-8000-000000000001')));
SELECT pg_temp.expect_fail('only one open offer per auction',
 $q$INSERT INTO auctions.second_chance_offers (auction_id, bidder_id, price, expires_at) VALUES ('e1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000003',100000,now())$q$,
 'offer_one_open');

-- ---------------------------------------------------------------- search (FR-SRC-01/02/05)
SELECT pg_temp.new_auction('e1000000-0000-4000-8000-000000000006', 100000, NULL, interval '2 hours');
UPDATE listings.listings SET locked_at = NULL WHERE id = 'e1000000-0000-4000-8000-000000000006';
INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
     fulfilment_options, area_district, approx_lat, approx_lng, price)
VALUES ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000005', 'physical', 'fixed_price', 104,
     'স্যামসাং মোবাইল ফোন', 'ভালো অবস্থায় আছে, ব্যাটারি নতুন। Samsung Galaxy A52.', 'used', true, 'pickup_only', 'Chattogram', 22.357, 91.783, 1800000);
INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height)
VALUES ('e0000000-0000-4000-8000-000000000002', 1, 'q-1', 800, 600), ('e0000000-0000-4000-8000-000000000002', 2, 'q-2', 800, 600);
UPDATE listings.listings SET status='active', published_at=now() WHERE id='e0000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('FR-SRC-01 a Bangla word finds the listing',
 EXISTS (SELECT 1 FROM listings.searchable WHERE search_tsv @@ plainto_tsquery('simple', 'মোবাইল') AND id='e0000000-0000-4000-8000-000000000002'));
SELECT pg_temp.ok('FR-SRC-01 an English word finds the same listing',
 EXISTS (SELECT 1 FROM listings.searchable WHERE search_tsv @@ plainto_tsquery('simple', 'samsung') AND id='e0000000-0000-4000-8000-000000000002'));
SELECT pg_temp.ok('a part of a word matches through trigrams (galax)',
 EXISTS (SELECT 1 FROM listings.listings WHERE id='e0000000-0000-4000-8000-000000000002' AND (title || ' ' || description) ILIKE '%galax%'));
SELECT pg_temp.ok('FR-SRC-02 Dhaka to Chattogram is about 215 km (rounded coordinates)',
 round(listings.distance_km(23.810, 90.410, 22.357, 91.783)::numeric) BETWEEN 205 AND 225);
SELECT pg_temp.ok('closed auctions and sold listings are not searchable',
 NOT EXISTS (SELECT 1 FROM listings.searchable WHERE id IN ('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000001')));
UPDATE listings.listings SET seller_visible = false WHERE seller_id = 'c0000000-0000-4000-8000-000000000005';
SELECT pg_temp.ok('FR-SRC-04 listings of a suspended or unverified seller disappear from search',
 NOT EXISTS (SELECT 1 FROM listings.searchable WHERE seller_id = 'c0000000-0000-4000-8000-000000000005'));
SELECT pg_temp.expect_fail('FR-TNS-05 a hidden seller''s auction takes no bids',
 $q$SELECT * FROM auctions.place_bid('e1000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000001',200000)$q$, 'listing not available');
SELECT pg_temp.ok('FR-FIX-05 and FR-SRC-04 a hidden seller''s stock cannot be reserved',
 NOT listings.reserve('e0000000-0000-4000-8000-000000000002', 1));

-- ---------------------------------------------------------------- grants
SET LOCAL ROLE tb_app;
SELECT pg_temp.expect_fail('application role cannot rewrite listing history',
 $q$UPDATE listings.status_history SET reason='x'$q$, 'permission denied');
SELECT pg_temp.expect_fail('application role cannot delete bids',
 $q$DELETE FROM auctions.bids$q$, 'permission denied');
RESET ROLE;

ROLLBACK;
