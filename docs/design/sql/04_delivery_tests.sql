-- Tests for the database-enforced rules of Unit 4 (Delivery & Handover). Run after the
-- Unit 1, 2, 3 and 4 schemas:  psql -v ON_ERROR_STOP=1 -f 04_delivery_tests.sql
-- Each rejection must name the intended rule. Runs in one transaction and rolls back, so it
-- can be rerun. Inside one transaction now() is constant; past and future times are set
-- explicitly in the fixtures.
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

-- ---------------------------------------------------------------- fixtures
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash) VALUES
 ('a0000000-0000-4000-8000-000000000001', 'admin@tb.test', 'Admin', 'administrator', 'active', '$argon2id$v=19$x');
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-000000000001', 'Buyer',    '+8801711000001', now(), 'b@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000002', 'Seller',   '+8801811000002', now(), 's@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000003', 'Stranger', '+8801911000003', now(), 'x@tb.test', '$argon2id$v=19$x', true, now());
INSERT INTO listings.categories (id, slug, name_en, name_bn, item_kind, prohibited) OVERRIDING SYSTEM VALUE VALUES
 (201, 'phones-u4', 'Phones', 'মোবাইল ফোন', 'physical', false);
INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, condition,
     no_visible_defects, weight_class, size_class, fulfilment_options, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
VALUES
 ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'physical', 'fixed_price', 201,
  'Used phone', 'A used phone in good condition, with charger.', 'used', true, 'up_to_1kg', 'small',
  'pickup_or_courier', 'Dhaka', 23.746, 90.376, 1000000, 5, 5),
 ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'physical', 'fixed_price', 201,
  'Heavy speaker', 'A large speaker cabinet, collect only, very heavy.', 'used', true, 'up_to_5kg', 'medium',
  'pickup_only', 'Dhaka', 23.746, 90.376, 500000, 3, 3);
INSERT INTO delivery.areas (id, district, name_en, name_bn, zone, lat, lng) OVERRIDING SYSTEM VALUE VALUES
 (1, 'Dhaka',      'Dhanmondi',     'ধানমন্ডি',   'inside_dhaka',  23.746, 90.376),
 (2, 'Dhaka',      'Mirpur',        'মিরপুর',     'inside_dhaka',  23.807, 90.368),
 (3, 'Dhaka',      'Gulshan',       'গুলশান',     'inside_dhaka',  23.792, 90.416),
 (4, 'Dhaka',      'Savar',         'সাভার',      'dhaka_suburbs', 23.858, 90.267),
 (5, 'Gazipur',    'Gazipur Sadar', 'গাজীপুর সদর', 'dhaka_suburbs', 23.999, 90.420),
 (6, 'Chattogram', 'Kotwali',       'কোতোয়ালী',   'outside_dhaka', 22.335, 91.834);
INSERT INTO delivery.meetup_points (id, kind, name_en, name_bn, district, lat, lng, active, added_by) VALUES
 ('f0000000-0000-4000-8000-000000000001', 'shopping_mall',  'Mall entrance (test)',       'মল', 'Dhaka', 23.77000, 90.39500, true,  'a0000000-0000-4000-8000-000000000001'),
 ('f0000000-0000-4000-8000-000000000002', 'bank_branch',    'Closed bank branch (test)',  'ব্যাংক', 'Dhaka', 23.76900, 90.39600, false, 'a0000000-0000-4000-8000-000000000001'),
 ('f0000000-0000-4000-8000-000000000003', 'police_station', 'Police station (test)',      'থানা', 'Dhaka', 23.74400, 90.37800, true,  'a0000000-0000-4000-8000-000000000001'),
 ('f0000000-0000-4000-8000-000000000004', 'police_station', 'Chattogram station (test)',  'থানা', 'Chattogram', 22.33500, 91.83400, true, 'a0000000-0000-4000-8000-000000000001');

INSERT INTO delivery.saved_addresses (id, user_id, kind, label, area_id, address_enc) VALUES
 ('a4000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'dropoff', 'Home',   2, decode(repeat('ab', 40), 'hex')),
 ('a4000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'dropoff', 'Office', 4, decode(repeat('ab', 40), 'hex')),
 ('a4000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'dropoff', 'Family', 6, decode(repeat('ab', 40), 'hex')),
 ('a4000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000003', 'dropoff', 'Other',  2, decode(repeat('ab', 40), 'hex'));

-- a paid order (Unit 2 rules), courier or self-pickup
CREATE FUNCTION pg_temp.paid_order(p_id uuid, p_courier boolean, p_quote uuid, p_fee bigint, p_due timestamptz) RETURNS void LANGUAGE sql AS $$
  INSERT INTO orders.orders (id, kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price,
      fulfilment, delivery_quote_id, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps,
      params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
  VALUES (p_id, 'fixed_price', 'e0000000-0000-4000-8000-000000000001', 'physical',
      'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 1000000, 1000000,
      CASE WHEN p_courier THEN 'courier'::orders.fulfilment ELSE 'self_pickup' END, p_quote, p_fee, 1000000 + p_fee,
      '{"title":"Used phone"}', 500, 1000, 1, now(), 'paid', now(),
      CASE WHEN p_courier THEN 'courier_pickup'::orders.fulfilment_step ELSE 'meetup_handover' END, p_due)
$$;
-- a courier order with its claimed quote and a forward shipment in 'preparing'; returns the shipment id
CREATE FUNCTION pg_temp.courier_order(p_order uuid, p_due timestamptz) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE q delivery.quotes; sid uuid;
BEGIN
  q := delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1,
         'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.746, 90.376, 2, interval '30 minutes', 10, 'a4000000-0000-4000-8000-000000000002');
  PERFORM pg_temp.paid_order(p_order, true, q.id, q.fee, p_due);
  PERFORM delivery.claim_quote(q.id, p_order, 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1);
  INSERT INTO delivery.shipments (order_id, direction, provider, simulated, quote_id, fee, pickup_due_at, dropoff_area_id, dropoff_address_enc)
  VALUES (p_order, 'forward', 'mock', true, q.id, q.fee, p_due, 2, decode(repeat('ab', 40), 'hex')) RETURNING id INTO sid;
  RETURN sid;
END $$;
CREATE FUNCTION pg_temp.book(p_ship uuid, p_cons text, p_at timestamptz) RETURNS void LANGUAGE sql AS $$
  UPDATE delivery.shipments SET status = 'booked', consignment_id = p_cons, booked_at = p_at,
         pickup_area_id = 1, pickup_address_enc = decode(repeat('cd', 40), 'hex')
   WHERE id = p_ship
$$;

-- ---------------------------------------------------------------- zones, weights, fares
SELECT pg_temp.ok('CP-43 both ends inside Dhaka: inside zone', delivery.route_zone('inside_dhaka', 'inside_dhaka') = 'inside_dhaka');
SELECT pg_temp.ok('CP-43 inside Dhaka to a suburb: suburbs zone', delivery.route_zone('inside_dhaka', 'dhaka_suburbs') = 'dhaka_suburbs');
SELECT pg_temp.ok('CP-43 suburb to outside Dhaka: outside zone', delivery.route_zone('dhaka_suburbs', 'outside_dhaka') = 'outside_dhaka');
SELECT pg_temp.ok('a listing near Dhanmondi is inside Dhaka; near Savar (same district) is a suburb',
  delivery.zone_at('Dhaka', 23.750, 90.380) = 'inside_dhaka' AND delivery.zone_at('Dhaka', 23.850, 90.270) = 'dhaka_suburbs');
SELECT pg_temp.ok('a district with no listed areas is outside Dhaka', delivery.zone_at('Rajshahi', 24.370, 88.600) = 'outside_dhaka');
SELECT pg_temp.ok('DV-25 billed weight: 1 kg small = 1; 1 kg large = 5 (volumetric); 3 x 2 kg = 6',
  delivery.billed_kg('up_to_1kg', 'small', 1, 10) = 1 AND delivery.billed_kg('up_to_1kg', 'large', 1, 10) = 5
  AND delivery.billed_kg('up_to_2kg', 'small', 3, 10) = 6);
SELECT pg_temp.ok('DV-24 over 10 kg in total, an over-10 kg item or an oversize item cannot go by courier',
  delivery.billed_kg('up_to_5kg', 'small', 3, 10) IS NULL AND delivery.billed_kg('over_10kg', 'small', 1, 10) IS NULL
  AND delivery.billed_kg('up_to_1kg', 'oversize', 1, 10) IS NULL);
SELECT pg_temp.ok('fare v1: inside Dhaka 1 kg = BDT 50; 5 kg = 65 + 3 x 15 = BDT 110; outside 2 kg = BDT 120',
  delivery.fare(1, 'inside_dhaka', 1) = 5000 AND delivery.fare(1, 'inside_dhaka', 5) = 11000 AND delivery.fare(1, 'outside_dhaka', 2) = 12000);
SAVEPOINT fares;
INSERT INTO delivery.fare_tables (version, effective_from, source, created_by)
VALUES (2, now() - interval '1 hour', 'Test version with rows added one at a time', 'a0000000-0000-4000-8000-000000000001');
INSERT INTO delivery.fare_rows VALUES (2, 'inside_dhaka', 6000, 7000, 1500);
SELECT pg_temp.ok('a fare version is not used until it has all three zones', delivery.fare_version_at(now()) = 1);
INSERT INTO delivery.fare_rows VALUES (2, 'dhaka_suburbs', 9000, 10000, 1500), (2, 'outside_dhaka', 11000, 13000, 2000);
SELECT pg_temp.ok('a complete newer version takes effect', delivery.fare_version_at(now()) = 2);
ROLLBACK TO SAVEPOINT fares;
SELECT pg_temp.expect_fail('fare rows are append-only (publish a new version instead)',
 $q$UPDATE delivery.fare_rows SET up_to_1kg = 1 WHERE version = 1$q$, 'append-only');
SELECT pg_temp.expect_fail('a fare must not fall with weight',
 $q$INSERT INTO delivery.fare_tables (version, effective_from, source, created_by) VALUES (3, now(), 'Test version three source', 'a0000000-0000-4000-8000-000000000001');
    INSERT INTO delivery.fare_rows VALUES (3, 'inside_dhaka', 7000, 6000, 1500)$q$, 'fare_rises_with_weight');
SELECT pg_temp.expect_fail('a published fare version names the administrator',
 $q$INSERT INTO delivery.fare_tables (version, effective_from, source) VALUES (4, now(), 'No creator given here')$q$, 'fare_version_has_creator');

-- ---------------------------------------------------------------- recommendation (FR-DLV-02)
SELECT pg_temp.ok('FR-DLV-02 at or below CP-14 (2 km) self-pickup is recommended; above it, courier',
  delivery.recommended_method('pickup_or_courier', 1.5, 2) = 'self_pickup' AND delivery.recommended_method('pickup_or_courier', 2.0, 2) = 'self_pickup'
  AND delivery.recommended_method('pickup_or_courier', 2.1, 2) = 'courier');
SELECT pg_temp.ok('FR-DLV-02 only allowed methods are recommended',
  delivery.recommended_method('pickup_only', 50, 2) = 'self_pickup' AND delivery.recommended_method('courier_only', 0.5, 2) = 'courier');

-- ---------------------------------------------------------------- quotes (FR-DLV-08, FR-DLV-09)
SELECT pg_temp.ok('FR-DLV-08 Dhanmondi to Mirpur, 1 kg: inside Dhaka, BDT 50, distance recorded',
  (SELECT fee = 5000 AND zone = 'inside_dhaka' AND distance_km BETWEEN 5 AND 8
     FROM delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1,
          'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.746, 90.376, 2, interval '30 minutes', 10, 'a4000000-0000-4000-8000-000000000002')));
SELECT pg_temp.ok('FR-DLV-08 Dhanmondi to Savar: suburbs, BDT 80',
  (SELECT fee = 8000 AND zone = 'dhaka_suburbs'
     FROM delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1,
          'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.746, 90.376, 4, interval '30 minutes', 10, 'a4000000-0000-4000-8000-000000000004')));
SELECT pg_temp.ok('FR-DLV-08 Dhanmondi to Chattogram, 2 units: outside Dhaka, 2 kg, BDT 120',
  (SELECT fee = 12000 AND zone = 'outside_dhaka' AND billed_kg = 2
     FROM delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 2,
          'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.746, 90.376, 6, interval '30 minutes', 10, 'a4000000-0000-4000-8000-000000000006')));
SELECT pg_temp.expect_fail('FR-DLV-02 no courier quote for a pickup-only listing',
 $q$SELECT delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002', 1,
     'pickup_only', 'up_to_5kg', 'medium', 'Dhaka', 23.746, 90.376, 2, interval '30 minutes', 10, 'a4000000-0000-4000-8000-000000000002')$q$, 'does not offer courier');
SELECT pg_temp.expect_fail('DV-24 no quote for a parcel over the courier limit',
 $q$SELECT delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 3,
     'pickup_or_courier', 'up_to_5kg', 'small', 'Dhaka', 23.746, 90.376, 2, interval '30 minutes', 10, 'a4000000-0000-4000-8000-000000000002')$q$, 'too heavy or too large');
SELECT pg_temp.expect_fail('FR-DLV-07 a quote uses the buyer''s own drop-off address',
 $q$SELECT delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1,
     'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.746, 90.376, 2, interval '30 minutes', 10, 'a4000000-0000-4000-8000-000000000009')$q$, 'buyer''s own');
SELECT pg_temp.expect_fail('the drop-off address must lie in the quoted area',
 $q$SELECT delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1,
     'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.746, 90.376, 2, interval '30 minutes', 10, 'a4000000-0000-4000-8000-000000000004')$q$, 'in the quoted area');
SELECT pg_temp.expect_fail('a checkout quote always has a drop-off address',
 $q$SELECT delivery.make_quote('checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1,
     'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.746, 90.376, 2, interval '30 minutes', 10)$q$, 'checkout_quote_has_address');

INSERT INTO delivery.quotes (id, purpose, buyer_id, listing_id, quantity, fare_version, from_zone, to_area_id, dropoff_address_id, zone, billed_kg, distance_km, fee, expires_at)
VALUES ('a1000000-0000-4000-8000-000000000001', 'checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
        1, 1, 'inside_dhaka', 2, 'a4000000-0000-4000-8000-000000000002', 'inside_dhaka', 1, 6.8, 5000, now() + interval '30 minutes');
SELECT pg_temp.paid_order('d0000000-0000-4000-8000-000000000009', true, 'a1000000-0000-4000-8000-000000000001', 5000, now() + interval '3 days');
SELECT pg_temp.expect_fail('FR-DLV-08 a quote is fixed once issued',
 $q$UPDATE delivery.quotes SET fee = 1 WHERE id = 'a1000000-0000-4000-8000-000000000001'$q$, 'fixed once issued');
SELECT pg_temp.expect_fail('a quote is claimed only by the buyer it was issued to',
 $q$SELECT delivery.claim_quote('a1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 1)$q$, 'does not match');
SELECT pg_temp.expect_fail('a quote is claimed only for the quantity it priced',
 $q$SELECT delivery.claim_quote('a1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 2)$q$, 'does not match');
SELECT pg_temp.ok('FR-DLV-08 claiming fixes the fee on the order (BDT 50)',
  delivery.claim_quote('a1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1) = 5000);
SELECT pg_temp.expect_fail('a quote is used by one order only',
 $q$SELECT delivery.claim_quote('a1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1)$q$, 'already used');
INSERT INTO delivery.quotes (id, purpose, buyer_id, listing_id, quantity, fare_version, from_zone, to_area_id, dropoff_address_id, zone, billed_kg, distance_km, fee, created_at, expires_at)
VALUES ('a1000000-0000-4000-8000-000000000002', 'checkout', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
        1, 1, 'inside_dhaka', 2, 'a4000000-0000-4000-8000-000000000002', 'inside_dhaka', 1, 6.8, 5000, now() - interval '1 hour', now() - interval '30 minutes');
SELECT pg_temp.expect_fail('DV-23 an expired quote cannot be used',
 $q$SELECT delivery.claim_quote('a1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1)$q$, 'quote expired');

-- ---------------------------------------------------------------- meetup points (FR-DLV-03)
SELECT pg_temp.ok('FR-DLV-03 suggestions are the nearest active points to the midpoint, in order',
  (SELECT array_agg(point_id ORDER BY km_from_midpoint) FROM delivery.suggest_points(23.746, 90.376, 23.792, 90.416, 2, 0.02))
  = ARRAY['f0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000003']::uuid[]);
SELECT pg_temp.ok('FR-DLV-07 the midpoint uses snapped locations: moving one party by 300 m does not change it',
  (SELECT array_agg(point_id ORDER BY km_from_midpoint) FROM delivery.suggest_points(23.746, 90.376, 23.792, 90.416, 3, 0.02))
  = (SELECT array_agg(point_id ORDER BY km_from_midpoint) FROM delivery.suggest_points(23.744, 90.379, 23.792, 90.416, 3, 0.02))
  AND (SELECT array_agg(km_from_midpoint ORDER BY km_from_midpoint) FROM delivery.suggest_points(23.746, 90.376, 23.792, 90.416, 3, 0.02))
  = (SELECT array_agg(km_from_midpoint ORDER BY km_from_midpoint) FROM delivery.suggest_points(23.744, 90.379, 23.792, 90.416, 3, 0.02)));

-- ---------------------------------------------------------------- meetup handover (FR-DLV-04 to FR-DLV-06)
SELECT pg_temp.paid_order('d0000000-0000-4000-8000-000000000001', false, NULL, 0, now() + interval '7 days');
SELECT pg_temp.expect_fail('a handover starts as arranging',
 $q$INSERT INTO delivery.handovers (order_id, buyer_id, seller_id, status, due_at) VALUES ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'completed', now())$q$,
 'starts as arranging');
INSERT INTO delivery.handovers (order_id, buyer_id, seller_id, due_at)
VALUES ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', now() + interval '7 days');
SELECT pg_temp.expect_fail('FR-DLV-04 only the buyer or the seller can propose a meetup',
 $q$SELECT delivery.propose_meetup('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'f0000000-0000-4000-8000-000000000001', now() + interval '1 day', NULL, interval '1 hour', interval '2 hours')$q$,
 'only the buyer or the seller');
SELECT pg_temp.expect_fail('DV-26 a meetup must be at least the lead time ahead',
 $q$SELECT delivery.propose_meetup('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', now() + interval '30 minutes', NULL, interval '1 hour', interval '2 hours')$q$,
 'meetup time must be');
SELECT pg_temp.expect_fail('DV-26 a meetup must leave the buffer before the CP-15 deadline',
 $q$SELECT delivery.propose_meetup('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', now() + interval '7 days' - interval '1 hour', NULL, interval '1 hour', interval '2 hours')$q$,
 'meetup time must be');
SELECT pg_temp.expect_fail('FR-DLV-03 a meetup is only at an active curated point',
 $q$SELECT delivery.propose_meetup('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000002', now() + interval '1 day', NULL, interval '1 hour', interval '2 hours')$q$,
 'not an active meetup point');
SELECT delivery.propose_meetup('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
       'f0000000-0000-4000-8000-000000000001', now() + interval '1 day', 'After 4 pm please', interval '1 hour', interval '2 hours') AS p1 \gset
SELECT delivery.propose_meetup('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
       'f0000000-0000-4000-8000-000000000003', now() + interval '2 days', NULL, interval '1 hour', interval '2 hours') AS p2 \gset
SELECT pg_temp.ok('FR-DLV-04 a counter-proposal replaces the open one; only one is open',
  (SELECT status FROM delivery.meetup_proposals WHERE id = :'p1') = 'superseded'
  AND (SELECT count(*) FROM delivery.meetup_proposals WHERE order_id = 'd0000000-0000-4000-8000-000000000001' AND status = 'proposed') = 1);
SELECT pg_temp.expect_fail('FR-DLV-04 the proposer cannot accept their own proposal',
 $q$SELECT delivery.respond_meetup('$q$ || :'p2' || $q$', 'c0000000-0000-4000-8000-000000000002', true)$q$, 'only the other party');
SELECT delivery.respond_meetup(:'p2', 'c0000000-0000-4000-8000-000000000001', true) AS r \gset
SELECT pg_temp.ok('FR-DLV-04 the other party accepts; the agreed point and time are recorded',
  :'r' = 'accepted'
  AND (SELECT status = 'agreed' AND agreed_proposal_id = :'p2' FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('a proposal cannot be edited after it is made',
 $q$UPDATE delivery.meetup_proposals SET meet_at = now() + interval '3 days' WHERE id = '$q$ || :'p2' || $q$'$q$, 'cannot be edited');
SELECT delivery.propose_meetup('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
       'f0000000-0000-4000-8000-000000000001', now() + interval '3 days', 'Rescheduled', interval '1 hour', interval '2 hours') AS p3 \gset
SELECT pg_temp.ok('rescheduling: the earlier agreement stands until the new time is accepted',
  (SELECT agreed_proposal_id FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001') = :'p2');
SELECT delivery.respond_meetup(:'p3', 'c0000000-0000-4000-8000-000000000001', true) AS r \gset
SELECT pg_temp.ok('rescheduling: accepting the new time supersedes the old agreement',
  :'r' = 'accepted'
  AND (SELECT status FROM delivery.meetup_proposals WHERE id = :'p2') = 'superseded'
  AND (SELECT agreed_proposal_id FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001') = :'p3');
SELECT pg_temp.expect_fail('an answered proposal cannot be answered again',
 $q$SELECT delivery.respond_meetup('$q$ || :'p3' || $q$', 'c0000000-0000-4000-8000-000000000001', false)$q$, 'no longer open');
INSERT INTO delivery.meetup_proposals (id, order_id, proposed_by, point_id, meet_at)
VALUES ('a2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002',
        'f0000000-0000-4000-8000-000000000001', now() - interval '1 hour');
SELECT pg_temp.ok('a proposal whose time has passed lapses instead of being accepted',
  delivery.respond_meetup('a2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', true) = 'lapsed'
  AND (SELECT agreed_proposal_id FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001') = :'p3');

SELECT pg_temp.expect_fail('FR-DLV-06 only the seller enters the handover code',
 $q$SELECT delivery.record_code_entry('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', true, 5)$q$, 'only the seller');
SELECT pg_temp.expect_fail('CP-45 must stay within its permitted range 3 to 10',
 $q$SELECT delivery.record_code_entry('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', false, 20)$q$, 'between 3 and 10');
SELECT bool_and(delivery.record_code_entry('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', false, 5) = 'wrong') AS r
  FROM generate_series(1, 4) \gset
SELECT pg_temp.ok('FR-DLV-06 wrong entries 1 to 4 are counted',
  :'r'::boolean
  AND (SELECT wrong_entries FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001') = 4);
SELECT delivery.record_code_entry('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', false, 5) AS r \gset
SELECT pg_temp.ok('FR-DLV-06 the 5th wrong entry (CP-45) locks code entry, opens an issue and notifies both',
  :'r' = 'locked'
  AND (SELECT status FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001') = 'locked'
  AND EXISTS (SELECT 1 FROM delivery.issues WHERE order_id = 'd0000000-0000-4000-8000-000000000001' AND kind = 'code_locked' AND status = 'open')
  AND EXISTS (SELECT 1 FROM delivery.outbox WHERE event_type = 'delivery.handover.locked' AND aggregate_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('FR-DLV-06 no entry is accepted while locked, not even the right code',
 $q$SELECT delivery.record_code_entry('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', true, 5)$q$, 'code entry is locked');
SELECT pg_temp.expect_fail('the wrong-entry count cannot be reset by an ordinary update',
 $q$UPDATE delivery.handovers SET wrong_entries = 0 WHERE order_id = 'd0000000-0000-4000-8000-000000000001'$q$, 'change only by an unlock');
SELECT delivery.unlock_code('d0000000-0000-4000-8000-000000000001') AS r \gset
SELECT pg_temp.ok('an operator unlock issues code version 2, resets the count and keeps the agreement',
  :r = 2
  AND (SELECT status = 'agreed' AND wrong_entries = 0 AND code_version = 2 FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT delivery.record_code_entry('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', true, 5) AS r \gset
SELECT pg_temp.ok('FR-DLV-06 the correct code records the handover (the delivery event)',
  :'r' = 'accepted'
  AND (SELECT status FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001') = 'completed'
  AND EXISTS (SELECT 1 FROM delivery.outbox WHERE event_type = 'delivery.handover.completed'));
SELECT pg_temp.expect_fail('after the handover no further code is accepted',
 $q$SELECT delivery.record_code_entry('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', true, 5)$q$, 'handover is closed');
SELECT pg_temp.expect_fail('a completed handover cannot be reopened or cancelled',
 $q$UPDATE delivery.handovers SET status = 'cancelled', cancelled_at = now() WHERE order_id = 'd0000000-0000-4000-8000-000000000001'$q$, 'handover is closed');
SELECT pg_temp.ok('DR-06 every entry is logged with its code version (5 wrong on v1, 1 right on v2)',
  (SELECT count(*) FILTER (WHERE NOT correct AND code_version = 1) = 5 AND count(*) FILTER (WHERE correct AND code_version = 2) = 1
     FROM delivery.code_entries WHERE order_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('the code-entry log is append-only',
 $q$DELETE FROM delivery.code_entries$q$, 'append-only');
SELECT pg_temp.paid_order('d0000000-0000-4000-8000-000000000002', false, NULL, 0, now() - interval '1 minute');
INSERT INTO delivery.handovers (order_id, buyer_id, seller_id, due_at)
VALUES ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', now() - interval '1 minute');
SELECT pg_temp.expect_fail('FR-PAY-08 no handover is recorded after the CP-15 deadline',
 $q$SELECT delivery.record_code_entry('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', true, 5)$q$, 'deadline has passed');
UPDATE delivery.handovers SET status = 'cancelled', cancelled_at = now() WHERE order_id = 'd0000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('an order cancelled before handover cancels the handover',
  (SELECT status = 'cancelled' FROM delivery.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000002'));

-- ---------------------------------------------------------------- shipments (FR-DLV-10 to FR-DLV-14)
SELECT pg_temp.courier_order('d0000000-0000-4000-8000-000000000003', now() + interval '3 days') AS s3 \gset
SELECT pg_temp.expect_fail('a shipment uses its own claimed quote and fee',
 $q$INSERT INTO delivery.shipments (order_id, direction, provider, simulated, quote_id, fee, pickup_due_at, dropoff_area_id, dropoff_address_enc)
    SELECT 'd0000000-0000-4000-8000-000000000009', 'forward', 'mock', true, 'a1000000-0000-4000-8000-000000000001', 9999, now(), 2, decode(repeat('ab', 40), 'hex')$q$,
 'own claimed quote and fee');
SELECT pg_temp.expect_fail('FR-DLV-14 a mock booking is always marked simulated',
 $q$INSERT INTO delivery.shipments (order_id, direction, provider, simulated, quote_id, fee, pickup_due_at, dropoff_area_id, dropoff_address_enc)
    SELECT 'd0000000-0000-4000-8000-000000000009', 'forward', 'mock', false, 'a1000000-0000-4000-8000-000000000001', 5000, now(), 2, decode(repeat('ab', 40), 'hex')$q$,
 'shipment_simulated_iff_mock');
SELECT pg_temp.expect_fail('one forward shipment per order',
 $q$INSERT INTO delivery.shipments (order_id, direction, provider, simulated, quote_id, fee, pickup_due_at, dropoff_area_id, dropoff_address_enc)
    SELECT order_id, 'forward', 'mock', true, quote_id, fee, pickup_due_at, 2, dropoff_address_enc FROM delivery.shipments WHERE id = '$q$ || :'s3' || $q$'$q$,
 'shipment_one_per_direction');
SELECT pg_temp.expect_fail('FR-DLV-07 a booking needs the seller''s pickup address',
 $q$UPDATE delivery.shipments SET status = 'booked', consignment_id = 'MOCK-1', booked_at = now() WHERE id = '$q$ || :'s3' || $q$'$q$,
 'shipment_addresses');
SELECT pg_temp.expect_fail('a booking needs the provider''s consignment id',
 $q$UPDATE delivery.shipments SET status = 'booked', booked_at = now(), pickup_area_id = 1, pickup_address_enc = decode(repeat('cd', 40), 'hex') WHERE id = '$q$ || :'s3' || $q$'$q$,
 'shipment_booked_fields');
SELECT pg_temp.book(:'s3', 'MOCK-3', now() - interval '2 hours');
SELECT pg_temp.expect_fail('the consignment id is fixed once booked',
 $q$UPDATE delivery.shipments SET consignment_id = 'MOCK-X' WHERE id = '$q$ || :'s3' || $q$'$q$, 'consignment id is fixed');
SELECT pg_temp.ok('FR-DLV-10 pickup by webhook is applied, on time, and reported for the fulfilment step',
  (SELECT outcome = 'applied' AND pickup_recorded AND pickup_on_time AND NOT delivered
     FROM delivery.apply_status(:'s3', 'picked_up', now() - interval '1 hour', 'provider_webhook', 'ev-3-1')));
SELECT pg_temp.ok('SEC-PAY-04 the same provider event again has no effect',
  (SELECT outcome = 'duplicate' AND NOT pickup_recorded FROM delivery.apply_status(:'s3', 'picked_up', now() - interval '1 hour', 'provider_webhook', 'ev-3-1')));
SELECT pg_temp.ok('FR-DLV-10 in transit is applied', (SELECT outcome = 'applied' FROM delivery.apply_status(:'s3', 'in_transit', now() - interval '30 minutes', 'provider_webhook', 'ev-3-2')));
SELECT pg_temp.ok('a late-arriving older status (picked up after in transit) is ignored as stale',
  (SELECT outcome = 'stale' FROM delivery.apply_status(:'s3', 'picked_up', now() - interval '50 minutes', 'provider_webhook', 'ev-3-0'))
  AND (SELECT status FROM delivery.shipments WHERE id = :'s3') = 'in_transit');
SELECT pg_temp.expect_fail('FR-DLV-10 a webhook alone cannot record delivery',
 $q$SELECT * FROM delivery.apply_status('$q$ || :'s3' || $q$', 'delivered', now(), 'provider_webhook', 'ev-3-3')$q$,
 'provider status query');
SELECT * FROM delivery.apply_status(:'s3', 'delivered', now(), 'provider_query', 'ev-3-3') \gset a_
SELECT pg_temp.ok('FR-DLV-10 delivery confirmed by status query is the delivery event',
  (:'a_outcome' = 'applied' AND :'a_delivered'::boolean)
  AND (SELECT delivered_at IS NOT NULL FROM delivery.shipments WHERE id = :'s3'));
SELECT pg_temp.ok('nothing changes a delivered shipment (a later failure report is stale)',
  (SELECT outcome = 'stale' FROM delivery.apply_status(:'s3', 'delivery_failed', now(), 'provider_webhook', 'ev-3-4')));
SELECT pg_temp.expect_fail('a final shipment cannot be edited',
 $q$UPDATE delivery.shipments SET delivered_at = now() - interval '1 day' WHERE id = '$q$ || :'s3' || $q$'$q$, 'shipment is final');
SELECT pg_temp.ok('DR-06 the history records every status in order, with its source',
  (SELECT array_agg(to_status::text ORDER BY id) FROM delivery.shipment_history WHERE shipment_id = :'s3')
  = ARRAY['preparing', 'booked', 'picked_up', 'in_transit', 'delivered']
  AND (SELECT source FROM delivery.shipment_history WHERE shipment_id = :'s3' AND to_status = 'delivered') = 'provider_query');
UPDATE delivery.shipments SET addresses_erased_at = now(), pickup_address_enc = NULL, dropoff_address_enc = NULL WHERE id = :'s3';
SELECT pg_temp.ok('DV-30 a final shipment''s addresses can be erased',
  (SELECT pickup_address_enc IS NULL AND dropoff_address_enc IS NULL FROM delivery.shipments WHERE id = :'s3'));

SELECT pg_temp.courier_order('d0000000-0000-4000-8000-000000000004', now() + interval '3 days') AS s4 \gset
SELECT pg_temp.book(:'s4', 'MOCK-4', now() - interval '2 hours');
SELECT * FROM delivery.apply_status(:'s4', 'delivered', now() - interval '10 minutes', 'provider_query', 'ev-4-1') \gset a_
SELECT pg_temp.ok('a delivery reported straight after booking implies the pickup, at the same time',
  (:'a_outcome' = 'applied' AND :'a_pickup_recorded'::boolean AND :'a_pickup_on_time'::boolean AND :'a_delivered'::boolean)
  AND (SELECT array_agg(to_status::text ORDER BY id) FROM delivery.shipment_history WHERE shipment_id = :'s4')
      = ARRAY['preparing', 'booked', 'picked_up', 'delivered']);

SELECT pg_temp.courier_order('d0000000-0000-4000-8000-000000000005', now() - interval '1 hour') AS s5 \gset
SELECT pg_temp.book(:'s5', 'MOCK-5', now() - interval '4 days');
SELECT pg_temp.ok('FR-DLV-11 a pickup after the CP-16 deadline is recorded but reported as late',
  (SELECT outcome = 'applied' AND pickup_recorded AND NOT pickup_on_time
     FROM delivery.apply_status(:'s5', 'picked_up', now() + interval '1 day', 'provider_webhook', 'ev-5-1')));
SELECT pg_temp.ok('a provider time in the future is clamped to the server time',
  (SELECT picked_up_at = now() FROM delivery.shipments WHERE id = :'s5'));
SELECT * FROM delivery.apply_status(:'s5', 'returned_to_seller', now(), 'provider_query', 'ev-5-3', 6000) \gset a_
SELECT pg_temp.ok('FR-DLV-12 return to seller (confirmed by query) records the courier''s charge',
  (:'a_outcome' = 'applied' AND :'a_returned'::boolean)
  AND (SELECT return_charge FROM delivery.shipments WHERE id = :'s5') = 6000);

SELECT pg_temp.courier_order('d0000000-0000-4000-8000-000000000006', now() + interval '3 days') AS s6 \gset
SELECT pg_temp.book(:'s6', 'MOCK-6', now() - interval '2 hours');
UPDATE delivery.shipments SET order_cancelled_at = now() - interval '1 hour' WHERE id = :'s6';
SELECT * FROM delivery.apply_status(:'s6', 'picked_up', now(), 'provider_webhook', 'ev-6-1') \gset a_
SELECT pg_temp.ok('a pickup after the order was cancelled is flagged and raises an operator issue',
  (:'a_outcome' = 'applied' AND :'a_after_cancel'::boolean)
  AND EXISTS (SELECT 1 FROM delivery.issues WHERE order_id = 'd0000000-0000-4000-8000-000000000006' AND kind = 'pickup_after_cancel'));

SELECT pg_temp.courier_order('d0000000-0000-4000-8000-000000000007', now() + interval '3 days') AS s7 \gset
SELECT pg_temp.book(:'s7', 'MOCK-7', now() - interval '2 hours');
SELECT * FROM delivery.apply_status(:'s7', 'cancelled', now(), 'provider_query', 'ev-7-1') \gset a_
SELECT pg_temp.ok('a provider-confirmed cancellation before pickup cancels the shipment',
  (:'a_outcome' = 'applied')
  AND (SELECT status FROM delivery.shipments WHERE id = :'s7') = 'cancelled');
SELECT * FROM delivery.apply_status(:'s7', 'picked_up', now(), 'provider_webhook', 'ev-7-2') \gset a_
SELECT pg_temp.ok('progress reported on a cancelled booking is refused and sent to an operator',
  (:'a_outcome' = 'refused')
  AND EXISTS (SELECT 1 FROM delivery.issues WHERE order_id = 'd0000000-0000-4000-8000-000000000007' AND kind = 'status_refused'));

SELECT pg_temp.courier_order('d0000000-0000-4000-8000-000000000008', now() + interval '3 days') AS s8 \gset
SELECT pg_temp.ok('a status that skips the booking (preparing to picked up) is refused',
  (SELECT outcome = 'refused' FROM delivery.apply_status(:'s8', 'picked_up', now(), 'provider_webhook', 'ev-8-1'))
  AND (SELECT status FROM delivery.shipments WHERE id = :'s8') = 'preparing');
SELECT pg_temp.book(:'s8', 'MOCK-8', now() - interval '9 days');
SELECT * FROM delivery.apply_status(:'s8', 'picked_up', now() - interval '8 days', 'provider_webhook', 'ev-8-2') \g /dev/null
SELECT pg_temp.expect_fail('the courier''s return charge is recorded only on a return',
 $q$UPDATE delivery.shipments SET return_charge = 100 WHERE id = '$q$ || :'s8' || $q$'$q$, 'shipment_charge_only_on_return');
SELECT pg_temp.expect_fail('DV-30 addresses are erased only after the shipment is final',
 $q$UPDATE delivery.shipments SET addresses_erased_at = now(), pickup_address_enc = NULL, dropoff_address_enc = NULL WHERE id = '$q$ || :'s8' || $q$'$q$,
 'shipment_erase_only_when_final');
SELECT pg_temp.ok('FR-DLV-11 a not_received dispute is allowed CP-17 (7 days) after pickup without delivery',
  delivery.not_received_allowed('d0000000-0000-4000-8000-000000000008', interval '7 days'));
SELECT pg_temp.ok('FR-DLV-11 ... but not before',
  NOT delivery.not_received_allowed('d0000000-0000-4000-8000-000000000008', interval '9 days')
  AND NOT delivery.not_received_allowed('d0000000-0000-4000-8000-000000000004', interval '0 days'));

-- return shipment for dispute outcome (d): its own quote, claimed with purpose 'return'
SELECT id AS rq FROM delivery.make_quote('return', 'c0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1,
       NULL, 'up_to_1kg', 'small', 'Dhaka', 23.807, 90.368, 1, interval '30 minutes', 10) \gset
SELECT pg_temp.ok('FR-DSP-06(d) a return quote is claimed for an order that already used a checkout quote',
  delivery.claim_quote(:'rq', 'd0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001',
                       'e0000000-0000-4000-8000-000000000001', 1, 'return') = 5000);
INSERT INTO delivery.shipments (id, order_id, direction, provider, simulated, quote_id, fee, dropoff_area_id, dropoff_address_enc)
VALUES ('a3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000004', 'return', 'mock', true, :'rq', 5000, 1, decode(repeat('ef', 40), 'hex'));
SELECT pg_temp.book('a3000000-0000-4000-8000-000000000001', 'MOCK-R4', now() - interval '1 hour');
SELECT * FROM delivery.apply_status('a3000000-0000-4000-8000-000000000001', 'delivered', now(), 'provider_query', 'ev-r4-1') \g /dev/null
SELECT pg_temp.ok('FR-DSP-06(d) the return''s delivery is published for Disputes to complete the refund',
  EXISTS (SELECT 1 FROM delivery.outbox WHERE event_type = 'delivery.return.delivered' AND aggregate_id = 'd0000000-0000-4000-8000-000000000004'));

-- ---------------------------------------------------------------- issues, events, grants
SELECT pg_temp.expect_fail('an issue is resolved only with a staff member and a reason',
 $q$UPDATE delivery.issues SET status = 'resolved', resolved_at = now(), resolved_by = 'a0000000-0000-4000-8000-000000000001', resolution = 'ok' WHERE kind = 'code_locked'$q$,
 'issue_resolution');
SELECT pg_temp.expect_fail('DC-6 outbox events are named delivery.<entity>.<past>',
 $q$INSERT INTO delivery.outbox (event_type, aggregate_id, payload) VALUES ('orders.order.paid', gen_random_uuid(), '{}')$q$, 'outbox_event_type_check');
INSERT INTO delivery.provider_events (provider, event_id, received_at) VALUES ('mock', 'ev-old', now() - interval '31 days');
SET LOCAL ROLE tb_app;
SELECT pg_temp.expect_fail('application role cannot rewrite shipment history',
 $q$UPDATE delivery.shipment_history SET source = 'operator'$q$, 'permission denied');
SELECT pg_temp.expect_fail('application role cannot delete shipments',
 $q$DELETE FROM delivery.shipments$q$, 'permission denied');
DELETE FROM delivery.provider_events WHERE received_at < now() - interval '30 days';
RESET ROLE;
SELECT pg_temp.ok('SEC-PAY-04 the application purges event ids older than CP-32 (30 days), and only those',
  NOT EXISTS (SELECT 1 FROM delivery.provider_events WHERE event_id = 'ev-old')
  AND EXISTS (SELECT 1 FROM delivery.provider_events WHERE event_id = 'ev-3-1'));

ROLLBACK;
