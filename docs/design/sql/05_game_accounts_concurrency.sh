#!/bin/sh
# Concurrency tests for Unit 5. Needs a database with the Unit 1-5 schemas loaded.
# usage: PSQL="psql -h HOST -p PORT -U USER" sh 05_game_accounts_concurrency.sh DBNAME
# Each race starts N sessions that wait on one advisory lock held by a controller session,
# so that they are released together and contend for the same rows.
set -e
DB=${1:?database}; PSQL=${PSQL:-psql}
Q="$PSQL -X -q -t -A -d $DB"
OUT=$(mktemp -d)

$Q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash) VALUES
 ('a0000000-0000-4000-8000-0000000000c1', 'cadmin@tb.test', 'Admin', 'administrator', 'active', '$argon2id$v=19$x');
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash, created_by)
SELECT ('b0000000-0000-4000-8000-0000000000' || lpad(to_hex(n), 2, '0'))::uuid, 'cop' || n || '@tb.test', 'Op ' || n,
       'operator', 'active', '$argon2id$v=19$x', 'a0000000-0000-4000-8000-0000000000c1' FROM generate_series(1, 10) n;
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-0000000000c1', 'Buyer',  '+8801711000101', now(), 'cb@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-0000000000c2', 'Seller', '+8801811000102', now(), 'cs@tb.test', '$argon2id$v=19$x', true, now());
INSERT INTO identity.sessions (id, principal_type, user_id, idle_expires_at, absolute_expires_at) VALUES
 ('e5000000-0000-4000-8000-0000000000c1', 'user', 'c0000000-0000-4000-8000-0000000000c1', now() + interval '7 days', now() + interval '30 days');
INSERT INTO listings.categories (id, slug, name_en, name_bn, item_kind, prohibited) OVERRIDING SYSTEM VALUE VALUES
 (311, 'game-accounts-c', 'Game accounts', 'গেম', 'game_account', false);
INSERT INTO game_accounts.games (id, slug, name, platforms, code_placement, publisher_note) OVERRIDING SYSTEM VALUE VALUES
 (11, 'race-game', 'Race Game', ARRAY['android'], 'Profile bio', 'Transfers may be prohibited by the publisher.');
-- 40 listings: 1..10 share one player ID (approval race); 11..40 carry one order each
INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, price)
SELECT ('e0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid, 'c0000000-0000-4000-8000-0000000000c2',
       'game_account', 'fixed_price', 311, 'Race account', 'Account with rare cars and high rank.', 300000 FROM generate_series(1, 40) n;
INSERT INTO game_accounts.details (listing_id, seller_id, game_id, platform, player_id, contents)
SELECT ('e0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid, 'c0000000-0000-4000-8000-0000000000c2', 11, 'android',
       CASE WHEN n <= 10 THEN 'RACER-777' ELSE 'P-' || n END, 'Rank 50, 30 cars, season pass.' FROM generate_series(1, 40) n;
INSERT INTO game_accounts.ownership_proofs (id, listing_id, code, expires_at)
SELECT ('f0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid, ('e0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid,
       'TB-RACE-' || lpad(n::text, 4, '0'), now() + interval '7 days' FROM generate_series(1, 10) n;
UPDATE game_accounts.ownership_proofs SET status = 'submitted', submitted_at = now(), screenshot_key = 'k-' || id,
       screenshot_dek = '\x01', screenshot_sha256 = sha256(convert_to(id::text, 'UTF8')) WHERE listing_id::text LIKE 'e0000000-0000-4000-8000-0000000001%';
-- orders 11..40, paid; 11 = delivery race, 12 = final-step race, 13 = re-key race, 14 = fetch storm,
-- 15..34 = report-vs-recovery-e-mail pairs
INSERT INTO orders.orders (id, kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price,
    fulfilment, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
SELECT ('d0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid, 'fixed_price',
       ('e0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid, 'game_account',
       'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2', 1, 300000, 300000, 'game_account', 0, 300000,
       '{}', 500, 1000, 1, now() + interval '15 minutes' FROM generate_series(11, 40) n;
INSERT INTO game_accounts.handovers (order_id, listing_id, buyer_id, seller_id, disclosure_version)
SELECT ('d0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid, ('e0000000-0000-4000-8000-0000000001' || lpad(to_hex(n), 2, '0'))::uuid,
       'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2', 1 FROM generate_series(11, 40) n;
SELECT game_accounts.register_key(order_id, buyer_id, '\x04'::bytea || decode(repeat('11', 64), 'hex'), 'e5000000-0000-4000-8000-0000000000c1'),
       game_accounts.mark_paid(order_id, now() + interval '24 hours')
  FROM game_accounts.handovers WHERE order_id::text LIKE 'd0000000-0000-4000-8000-0000000001%';
SELECT game_accounts.deliver(order_id, seller_id, 1::smallint, '\x04'::bytea || decode(repeat('22', 64), 'hex'),
       decode(repeat('5a', 528), 'hex'), interval '24 hours')
  FROM game_accounts.handovers WHERE order_id::text LIKE 'd0000000-0000-4000-8000-0000000001%' AND order_id <> 'd0000000-0000-4000-8000-00000000010b';
SELECT game_accounts.confirm_step('d0000000-0000-4000-8000-00000000010c', 'c0000000-0000-4000-8000-0000000000c1', s, 'e5000000-0000-4000-8000-0000000000c1')
  FROM unnest(ARRAY['password', 'recovery_email', 'recovery_phone', 'social_logins']::game_accounts.takeover_step[]) s;
SQL

race() {   # race <name> <count> <sql with %N% replaced by the worker number>
  name=$1; n=$2; stmt=$3
  ( echo "SELECT pg_advisory_lock(4343);"; echo "\\! sleep 2"; echo "SELECT pg_advisory_unlock(4343);" ) | $Q >/dev/null &
  sleep 0.5
  i=1
  while [ $i -le $n ]; do
    s=$(echo "$stmt" | sed "s/%N%/$i/g")
    ( printf "SELECT pg_advisory_lock_shared(4343); SELECT pg_advisory_unlock_shared(4343) \\g /dev/null\n%s\n" "$s" \
        | $Q 2>&1 | grep -v '^$' > $OUT/$name.$i ) &
    i=$((i + 1))
  done
  wait
}
count() { cat $OUT/$1.* | grep -c -- "$2" || true; }

race approve 10 "SELECT game_accounts.review_proof(('f0000000-0000-4000-8000-0000000001' || lpad(to_hex(%N%), 2, '0'))::uuid,
    ('b0000000-0000-4000-8000-0000000000' || lpad(to_hex(%N%), 2, '0'))::uuid, true, 'matched', NULL);"
race deliver 10 "SELECT game_accounts.deliver('d0000000-0000-4000-8000-00000000010b', 'c0000000-0000-4000-8000-0000000000c2', 1::smallint,
    '\\x04'::bytea || decode(repeat('22', 64), 'hex'), decode(repeat('5a', 528), 'hex'), interval '24 hours');"
race final 10 "SELECT game_accounts.confirm_step('d0000000-0000-4000-8000-00000000010c', 'c0000000-0000-4000-8000-0000000000c1', 'two_step', 'e5000000-0000-4000-8000-0000000000c1');"
race rekey 10 "SELECT game_accounts.request_rekey('d0000000-0000-4000-8000-00000000010d', 'c0000000-0000-4000-8000-0000000000c1',
    '\\x04'::bytea || decode(repeat(lpad(to_hex(%N%), 2, '0'), 64), 'hex'), 'e5000000-0000-4000-8000-0000000000c1', interval '24 hours');"
race fetch 20 "SELECT key_version FROM game_accounts.fetch_sealed('d0000000-0000-4000-8000-00000000010e', 'c0000000-0000-4000-8000-0000000000c1',
    'e5000000-0000-4000-8000-0000000000c1', '10.0.0.%N%');"
# 20 orders (15..34); worker 2k-1 reports invalid, worker 2k confirms the recovery e-mail, on order 14+k
race pairs 40 "SELECT CASE WHEN %N% % 2 = 1 THEN
      (SELECT 'reported:' FROM (SELECT game_accounts.report_invalid(('d0000000-0000-4000-8000-0000000001' || lpad(to_hex(14 + (%N% + 1) / 2), 2, '0'))::uuid, 'c0000000-0000-4000-8000-0000000000c1')) x)
    ELSE (SELECT 'confirmed:' || game_accounts.confirm_step(('d0000000-0000-4000-8000-0000000001' || lpad(to_hex(14 + %N% / 2), 2, '0'))::uuid,
          'c0000000-0000-4000-8000-0000000000c1', 'recovery_email', 'e5000000-0000-4000-8000-0000000000c1')::text) END;"

echo "Approval race: 10 operators approve 10 listings of the same player ID at once"
echo "  results: approved $(count approve '^approved$'), refused $(count approve 'already listed')"
echo "  database: $($Q -c "SELECT 'live claims for the player ID=' || count(*) FROM game_accounts.claims WHERE game_id = 11 AND player_id_norm = 'racer-777' AND released_at IS NULL")"
echo "Delivery race: the seller's sealed credentials submitted 10 times at once"
echo "  results: accepted $(count deliver '^t$'), refused $(count deliver 'not expected now')"
echo "  database: $($Q -c "SELECT 'ciphertexts=' || count(*) FROM game_accounts.sealed_credentials WHERE order_id = 'd0000000-0000-4000-8000-00000000010b'")"
echo "Final-step race: the last checklist step confirmed 10 times at once"
echo "  results: completed $(count final '^t$'), refused or no-op $(($(count final '^f$') + $(count final 'not in progress')))"
echo "  database: $($Q -c "SELECT 'takeover events=' || count(*) FROM game_accounts.outbox WHERE event_type = 'game_accounts.takeover.completed' AND aggregate_id = 'd0000000-0000-4000-8000-00000000010c'")"
echo "Re-key race: 10 re-key requests at once"
echo "  results: accepted $(count rekey '^2$'), refused $(($(count rekey 'one re-key has been used') + $(count rekey 'only during the takeover window')))"
echo "  database: $($Q -c "SELECT 'keys=' || count(*) FROM game_accounts.buyer_keys WHERE order_id = 'd0000000-0000-4000-8000-00000000010d'")"
echo "Retrieval storm: 20 retrievals at once"
echo "  results: returned $(count fetch '^1$')"
echo "  database: $($Q -c "SELECT 'access log rows=' || count(*) FROM game_accounts.access_log WHERE order_id = 'd0000000-0000-4000-8000-00000000010e'")"
echo "Report-or-confirm race: 20 orders, each with an invalid-report and the e-mail step at once"
echo "  results: reports accepted $(count pairs '^reported:'), e-mail steps accepted $(count pairs '^confirmed:')"
echo "  database: $($Q -c "SELECT 'disputed=' || count(*) FILTER (WHERE status = 'disputed') || ', e-mail confirmed=' || count(*) FILTER (WHERE recovery_email_at IS NOT NULL) || ', both=' || count(*) FILTER (WHERE status = 'disputed' AND recovery_email_at IS NOT NULL) FROM game_accounts.handovers WHERE order_id::text LIKE 'd0000000-0000-4000-8000-0000000001%' AND order_id BETWEEN 'd0000000-0000-4000-8000-00000000010f' AND 'd0000000-0000-4000-8000-000000000122'")"
[ -n "$KEEP" ] && echo "kept $OUT" || rm -rf $OUT
