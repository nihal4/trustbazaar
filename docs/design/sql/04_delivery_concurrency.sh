#!/bin/sh
# Concurrency tests for Unit 4. Needs a database with the Unit 1-4 schemas loaded.
# usage: PSQL="psql -h HOST -p PORT -U USER" sh 04_delivery_concurrency.sh DBNAME
# Each race starts N separate sessions that wait on one advisory lock held by a controller
# session, so that they are released at the same moment and contend for the same rows.
set -e
DB=${1:?database}; PSQL=${PSQL:-psql}
Q="$PSQL -X -q -t -A -d $DB"
OUT=$(mktemp -d)

$Q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash) VALUES
 ('a0000000-0000-4000-8000-0000000000c1', 'cadmin@tb.test', 'Admin', 'administrator', 'active', '$argon2id$v=19$x');
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-0000000000c1', 'Buyer',  '+8801711000101', now(), 'cb@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-0000000000c2', 'Seller', '+8801811000102', now(), 'cs@tb.test', '$argon2id$v=19$x', true, now());
INSERT INTO listings.categories (id, slug, name_en, name_bn, item_kind, prohibited) OVERRIDING SYSTEM VALUE VALUES
 (301, 'phones-c', 'Phones', 'মোবাইল', 'physical', false);
INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, condition,
     no_visible_defects, weight_class, size_class, fulfilment_options, area_district, approx_lat, approx_lng, price)
VALUES ('e0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2', 'physical', 'fixed_price', 301,
  'Used phone', 'A used phone in good condition, with charger.', 'used', true, 'up_to_1kg', 'small',
  'pickup_or_courier', 'Dhaka', 23.746, 90.376, 1000000);
INSERT INTO delivery.areas (id, district, name_en, name_bn, zone, lat, lng) OVERRIDING SYSTEM VALUE VALUES
 (91, 'Dhaka', 'Dhanmondi', 'ধানমন্ডি', 'inside_dhaka', 23.746, 90.376);
INSERT INTO delivery.saved_addresses (id, user_id, kind, label, area_id, address_enc) VALUES
 ('a4000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c1', 'dropoff', 'Home', 91, decode(repeat('ab', 40), 'hex'));
INSERT INTO delivery.meetup_points (id, kind, name_en, name_bn, district, lat, lng, added_by) VALUES
 ('f0000000-0000-4000-8000-0000000000c1', 'police_station', 'Station (test)', 'থানা', 'Dhaka', 23.744, 90.378, 'a0000000-0000-4000-8000-0000000000c1');
-- orders c1 (wrong-code race), c2 (correct-code race), c3 (proposal race), c4 (webhook storm), c5..c14 (quote race)
INSERT INTO orders.orders (id, kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price,
    fulfilment, delivery_quote_id, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps,
    params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
SELECT ('d0000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'fixed_price', 'e0000000-0000-4000-8000-0000000000c1', 'physical',
       'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2', 1, 1000000, 1000000,
       'self_pickup', NULL, 0, 1000000, '{}', 500, 1000, 1, now(), 'paid', now(), 'meetup_handover', now() + interval '7 days'
  FROM generate_series(193, 206) n;   -- 0xc1 .. 0xce
INSERT INTO delivery.handovers (order_id, buyer_id, seller_id, due_at)
SELECT ('d0000000-0000-4000-8000-0000000000' || x)::uuid, 'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2', now() + interval '7 days'
  FROM unnest(ARRAY['c1', 'c2', 'c3']) x;
-- webhook storm: a booked shipment on order c4 (a courier order needs its own quote)
INSERT INTO delivery.quotes (id, purpose, buyer_id, listing_id, quantity, fare_version, from_zone, to_area_id, dropoff_address_id, zone, billed_kg, distance_km, fee, expires_at, order_id, claimed_at)
VALUES ('a1000000-0000-4000-8000-0000000000c4', 'checkout', 'c0000000-0000-4000-8000-0000000000c1', 'e0000000-0000-4000-8000-0000000000c1',
        1, 1, 'inside_dhaka', 91, 'a4000000-0000-4000-8000-0000000000c1', 'inside_dhaka', 1, 0, 5000, now() + interval '30 minutes', 'd0000000-0000-4000-8000-0000000000c4', now());
INSERT INTO delivery.shipments (id, order_id, direction, provider, simulated, quote_id, fee, pickup_due_at, dropoff_area_id, dropoff_address_enc)
VALUES ('a3000000-0000-4000-8000-0000000000c4', 'd0000000-0000-4000-8000-0000000000c4', 'forward', 'mock', true,
        'a1000000-0000-4000-8000-0000000000c4', 5000, now() + interval '3 days', 91, decode(repeat('ab', 40), 'hex'));
UPDATE delivery.shipments SET status = 'booked', consignment_id = 'MOCK-C4', booked_at = now() - interval '1 hour',
       pickup_area_id = 91, pickup_address_enc = decode(repeat('cd', 40), 'hex') WHERE id = 'a3000000-0000-4000-8000-0000000000c4';
-- quote race: one quote, ten orders
INSERT INTO delivery.quotes (id, purpose, buyer_id, listing_id, quantity, fare_version, from_zone, to_area_id, dropoff_address_id, zone, billed_kg, distance_km, fee, expires_at)
VALUES ('a1000000-0000-4000-8000-0000000000c5', 'checkout', 'c0000000-0000-4000-8000-0000000000c1', 'e0000000-0000-4000-8000-0000000000c1',
        1, 1, 'inside_dhaka', 91, 'a4000000-0000-4000-8000-0000000000c1', 'inside_dhaka', 1, 0, 5000, now() + interval '1 hour');
SQL

# race <name> <count> <sql with %N% replaced by the worker number>
race() {
  name=$1; n=$2; stmt=$3
  rm -f $OUT/$name.*
  ( echo "SELECT pg_advisory_lock(4242);"; echo "\\! sleep 2"; echo "SELECT pg_advisory_unlock(4242);" ) | $Q >/dev/null &
  ctl=$!
  sleep 0.5
  i=1
  while [ $i -le $n ]; do
    s=$(echo "$stmt" | sed "s/%N%/$i/g")
    ( printf "SELECT pg_advisory_lock_shared(4242); SELECT pg_advisory_unlock_shared(4242);\n%s\n" "$s" \
        | $Q 2>&1 | grep -v '^$' > $OUT/$name.$i ) &
    i=$((i + 1))
  done
  wait
}

race wrong 20 "SELECT delivery.record_code_entry('d0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2', false, 5);"
race right 10 "SELECT delivery.record_code_entry('d0000000-0000-4000-8000-0000000000c2', 'c0000000-0000-4000-8000-0000000000c2', true, 5);"
race propose 20 "SELECT delivery.propose_meetup('d0000000-0000-4000-8000-0000000000c3',
    CASE WHEN %N% % 2 = 0 THEN 'c0000000-0000-4000-8000-0000000000c1'::uuid ELSE 'c0000000-0000-4000-8000-0000000000c2'::uuid END,
    'f0000000-0000-4000-8000-0000000000c1', now() + interval '1 day' + %N% * interval '1 minute', NULL, interval '1 hour', interval '2 hours');"
race storm 15 "SELECT outcome FROM delivery.apply_status('a3000000-0000-4000-8000-0000000000c4', 'picked_up', now(), 'provider_webhook',
    CASE WHEN %N% <= 10 THEN 'ev-same' ELSE 'ev-' || %N% END);"
race claim 10 "SELECT delivery.claim_quote('a1000000-0000-4000-8000-0000000000c5',
    ('d0000000-0000-4000-8000-0000000000' || lpad(to_hex(196 + %N%), 2, '0'))::uuid,
    'c0000000-0000-4000-8000-0000000000c1', 'e0000000-0000-4000-8000-0000000000c1', 1);"

count() { cat $OUT/$1.* | grep -c -- "$2" || true; }
echo "Wrong-code race: 20 sessions enter a wrong code at once (CP-45 = 5)"
echo "  results: wrong $(count wrong '^wrong$'), locked $(count wrong '^locked$'), refused as locked $(count wrong 'code entry is locked')"
echo "  database: $($Q -c "SELECT 'wrong_entries=' || wrong_entries || ', status=' || status || ', logged entries=' || (SELECT count(*) FROM delivery.code_entries WHERE order_id = h.order_id) FROM delivery.handovers h WHERE order_id = 'd0000000-0000-4000-8000-0000000000c1'")"
echo "Correct-code race: 10 sessions enter the right code at once"
echo "  results: accepted $(count right '^accepted$'), refused as closed $(count right 'handover is closed')"
echo "  database: $($Q -c "SELECT 'completed events=' || count(*) FROM delivery.outbox WHERE event_type = 'delivery.handover.completed' AND aggregate_id = 'd0000000-0000-4000-8000-0000000000c2'")"
echo "Proposal race: 20 sessions (buyer and seller alternately) propose at once"
echo "  results: created $(cat $OUT/propose.* | grep -c -E '^[0-9a-f]{8}-' || true), errors $(cat $OUT/propose.* | grep -c ERROR || true)"
echo "  database: $($Q -c "SELECT 'open=' || count(*) FILTER (WHERE status = 'proposed') || ', superseded=' || count(*) FILTER (WHERE status = 'superseded') FROM delivery.meetup_proposals WHERE order_id = 'd0000000-0000-4000-8000-0000000000c3'")"
echo "Webhook storm: the same pickup event delivered 10 times plus 5 other pickup events, at once"
echo "  results: applied $(count storm '^applied$'), duplicate $(count storm '^duplicate$'), stale $(count storm '^stale$')"
echo "  database: $($Q -c "SELECT 'picked_up history rows=' || count(*) FROM delivery.shipment_history WHERE shipment_id = 'a3000000-0000-4000-8000-0000000000c4' AND to_status = 'picked_up'")"
echo "Quote race: 10 orders claim the same quote at once"
echo "  results: claimed $(count claim '^5000$'), refused as used $(count claim 'already used')"
echo "  database: $($Q -c "SELECT 'quote order=' || coalesce(order_id::text, 'none') FROM delivery.quotes WHERE id = 'a1000000-0000-4000-8000-0000000000c5'")"
rm -rf $OUT
