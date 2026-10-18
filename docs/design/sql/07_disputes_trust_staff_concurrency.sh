#!/bin/sh
# Concurrency tests for Unit 7. Needs a database with the Unit 1-7 schemas loaded.
# usage: PSQL="psql -h HOST -p PORT -U USER" sh 07_disputes_trust_staff_concurrency.sh DBNAME
# Each race starts N sessions released together by an advisory lock held by a controller session.
set -e
DB=${1:?database}; PSQL=${PSQL:-psql}
Q="$PSQL -X -q -t -A -d $DB"
OUT=$(mktemp -d)

$Q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash) VALUES
 ('a0000000-0000-4000-8000-0000000000c1', 'cadmin@tb.test', 'Admin', 'administrator', 'active', '$argon2id$v=19$x');
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash, created_by)
SELECT ('b0000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'cop' || n || '@tb.test', 'Op ' || n, 'operator', 'active',
       '$argon2id$v=19$x', 'a0000000-0000-4000-8000-0000000000c1' FROM generate_series(1, 10) n;
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-0000000000c1', 'Buyer',  '+8801711000101', now(), 'cb@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-0000000000c2', 'Seller', '+8801811000102', now(), 'cs@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-0000000000c3', 'Seller2','+8801611000103', now(), 'cs2@tb.test', '$argon2id$v=19$x', true, now());
-- orders 1..40: order 1 = opening race; 2..21 = decide-or-withdraw pairs; 22 = assignment and evidence races; 23..32 = strike storm
INSERT INTO orders.orders (id, kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price,
    fulfilment, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at,
    status, paid_at, fulfilment_step, fulfilment_due_at)
SELECT ('d0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid, 'fixed_price', gen_random_uuid(), 'physical',
       'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2', 1, 1000000, 1000000, 'self_pickup', 0, 1000000,
       '{}', 500, 1000, 1, now(), 'paid', now(), 'meetup_handover', now() + interval '7 days' FROM generate_series(1, 40) n;
-- disputes for orders 2..22, under review and assigned (2..21 to operator 1; 22 left unassigned)
SELECT disputes.open(('d0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid, 'c0000000-0000-4000-8000-0000000000c1',
       'c0000000-0000-4000-8000-0000000000c2', 'physical', 'damaged', 'The screen was cracked when the box was opened.',
       1000000, 1000000, true, '48 hours') FROM generate_series(2, 22) n;
SELECT disputes.seller_respond(id, seller_id, 'It was fine when handed over.', '5 days') FROM disputes.disputes;
SELECT disputes.assign(id, 'b0000000-0000-4000-8000-000000000001') FROM disputes.disputes
 WHERE order_id <> 'd0000000-0000-4000-8000-000000000116';
SQL

race() {   # race <name> <count> <sql with %N% replaced by the worker number>
  name=$1; n=$2; stmt=$3
  ( echo "SELECT pg_advisory_lock(4545);"; echo "\\! sleep 2"; echo "SELECT pg_advisory_unlock(4545);" ) | $Q >/dev/null &
  sleep 0.5
  i=1
  while [ $i -le $n ]; do
    s=$(echo "$stmt" | sed "s/%N%/$i/g")
    ( printf "SELECT pg_advisory_lock_shared(4545); SELECT pg_advisory_unlock_shared(4545) \\\\g /dev/null\n%s\n" "$s" \
        | $Q 2>&1 | grep -v '^$' > $OUT/$name.$i ) &
    i=$((i + 1))
  done
  wait
}
count() { cat $OUT/$1.* | grep -c -- "$2" || true; }
ord() { echo "('d0000000-0000-4000-8000-0000000001' || lpad(to_hex($1), 2, '0'))::uuid"; }

race open 10 "SELECT disputes.open($(ord 1), 'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2', 'physical',
    (ARRAY['damaged','not_as_described','not_received','other'])[1 + %N% % 4]::disputes.dispute_type,
    'Opened from session %N% about the same order.', 1000000, 1000000, true, '48 hours') IS NOT NULL;"
# 40 sessions on 20 disputes: odd workers decide, even workers withdraw, both on dispute of order 1 + ceil(N/2)
race pairs 40 "SELECT CASE WHEN %N% % 2 = 1 THEN
      (SELECT 'decided:' || disputes.decide(d.id, 'b0000000-0000-4000-8000-000000000001', 'release', 'Evidence shows the item was as described.')::text
         FROM disputes.disputes d WHERE d.order_id = ('d0000000-0000-4000-8000-0000000001' || lpad(to_hex(1 + (%N% + 1) / 2), 2, '0'))::uuid)
    ELSE (SELECT 'withdrawn:' FROM disputes.disputes d, LATERAL (SELECT disputes.withdraw(d.id, d.buyer_id)) w
         WHERE d.order_id = ('d0000000-0000-4000-8000-0000000001' || lpad(to_hex(1 + %N% / 2), 2, '0'))::uuid) END;"
race assign 10 "SELECT disputes.assign(id, ('b0000000-0000-4000-8000-0000000000' || lpad(to_hex(%N%), 2, '0'))::uuid) IS NULL
    FROM disputes.disputes WHERE order_id = $(ord 22);"
race evidence 15 "INSERT INTO disputes.evidence (dispute_id, party, storage_key, sha256, mime, byte_size)
    SELECT id, 'buyer', 'race-ev-%N%', sha256(int4send(%N%)), 'image/jpeg', 1000 FROM disputes.disputes WHERE order_id = $(ord 22) RETURNING 'stored';"
race strikes 10 "SELECT trust.record_strike('c0000000-0000-4000-8000-0000000000c3', 'missed_deadline', $(ord '22 + %N%'), '90 days', 3);"
race config 10 "SELECT staff.publish_config(jsonb_build_object('CP-13', (10 + %N%) || ' minutes'), 'a0000000-0000-4000-8000-0000000000c1', 'Concurrent change number %N%');"

echo "Opening race: 10 sessions open a dispute on the same order at once (different types)"
echo "  results: opened $(count open '^t$'), refused $(count open 'already open')"
echo "  database: $($Q -c "SELECT 'disputes on the order=' || count(*) FROM disputes.disputes WHERE order_id = 'd0000000-0000-4000-8000-000000000101'")"
echo "Decide-or-withdraw race: on 20 disputes, the operator decides while the buyer withdraws"
echo "  results: decided $(count pairs '^decided:'), withdrawn $(count pairs '^withdrawn:')"
echo "  database: $($Q -c "SELECT 'decided=' || count(*) FILTER (WHERE status = 'decided') || ', withdrawn=' || count(*) FILTER (WHERE status = 'withdrawn') || ', other=' || count(*) FILTER (WHERE status NOT IN ('decided', 'withdrawn')) FROM disputes.disputes WHERE order_id BETWEEN 'd0000000-0000-4000-8000-000000000102' AND 'd0000000-0000-4000-8000-000000000115'")"
echo "Assignment race: 10 operators take the same unassigned dispute at once"
echo "  results: refused $(count assign 'assigned to another operator') of 10"
echo "  database: $($Q -c "SELECT 'assigned to one operator=' || (assigned_to IS NOT NULL) FROM disputes.disputes WHERE order_id = 'd0000000-0000-4000-8000-000000000116'")"
echo "Evidence race: 15 uploads at once to one dispute (CP-33 limit 10)"
echo "  results: stored $(count evidence '^stored$'), refused $(count evidence 'at most 10 evidence files')"
echo "Strike race: 10 strikes for one seller at once (CP-47 = 3 in 90 days)"
echo "  database: $($Q -c "SELECT 'strikes=' || (SELECT count(*) FROM trust.strikes WHERE user_id = 'c0000000-0000-4000-8000-0000000000c3') || ', automatic suspensions=' || count(*) FROM trust.sanctions WHERE user_id = 'c0000000-0000-4000-8000-0000000000c3' AND automatic")"
echo "Parameter race: 10 administrators publish changes at once"
echo "  database: $($Q -c "SELECT 'versions=' || count(*) || ' (' || min(version) || '..' || max(version) || '), each with ' || min(n) || '-' || max(n) || ' values' FROM (SELECT version, count(*) n FROM staff.config_values GROUP BY version) x")"
[ -n "$KEEP" ] && echo "kept $OUT" || rm -rf $OUT
