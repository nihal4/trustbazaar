#!/bin/sh
# Concurrency tests for Unit 6. Needs a database with the Unit 1-6 schemas loaded.
# usage: PSQL="psql -h HOST -p PORT -U USER" sh 06_chat_notifications_concurrency.sh DBNAME
# Each race starts N sessions released together by an advisory lock held by a controller session.
set -e
DB=${1:?database}; PSQL=${PSQL:-psql}
Q="$PSQL -X -q -t -A -d $DB"
OUT=$(mktemp -d)

$Q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-0000000000c1', 'Buyer',  '+8801711000101', now(), 'cb@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-0000000000c2', 'Seller', '+8801811000102', now(), 'cs@tb.test', '$argon2id$v=19$x', true, now());
INSERT INTO listings.categories (id, slug, name_en, name_bn, item_kind, prohibited) OVERRIDING SYSTEM VALUE VALUES
 (411, 'phones-c6', 'Phones', 'মোবাইল', 'physical', false);
INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, condition,
     no_visible_defects, fulfilment_options, area_district, approx_lat, approx_lng, price)
SELECT ('e0000000-0000-4000-8000-0000000002' || lpad(to_hex(n), 2, '0'))::uuid, 'c0000000-0000-4000-8000-0000000000c2', 'physical', 'fixed_price', 411,
       'Used phone', 'A used phone in good condition, with charger.', 'used', true, 'pickup_only', 'Dhaka', 23.746, 90.376, 1000000
  FROM generate_series(1, 3) n;
INSERT INTO chat.threads (id, listing_id, buyer_id, seller_id) VALUES
 ('a6000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2'),
 ('a6000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000202', 'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2'),
 ('a6000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000203', 'c0000000-0000-4000-8000-0000000000c2', 'c0000000-0000-4000-8000-0000000000c1');
-- thread 3: the buyer (here user c2) has sent 20 messages that the seller (c1) has not yet acknowledged
SELECT count(*) FROM generate_series(1, 20) i,
  LATERAL chat.post('a6000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-0000000000c2', gen_random_uuid(), 'text', 'hello ' || i);
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('order.paid', 1, 'transaction', '{email}', '{listing_title}', 'Payment received', 'পেমেন্ট গৃহীত', 'Paid: {listing_title}', 'পরিশোধিত: {listing_title}');
SELECT notify.schedule_reminder('c0000000-0000-4000-8000-0000000000c1', 'payment_window', gen_random_uuid(), now() + interval '1 hour', interval '2 hours')
  FROM generate_series(1, 50);
-- 1000 messages in thread 2 to time chat.post inside the database
DO $$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN
  FOR i IN 1..1000 LOOP
    PERFORM * FROM chat.post('a6000000-0000-4000-8000-000000000002',
      CASE WHEN i % 2 = 0 THEN 'c0000000-0000-4000-8000-0000000000c1'::uuid ELSE 'c0000000-0000-4000-8000-0000000000c2' END,
      gen_random_uuid(), 'text', 'Message number ' || i || ', can we meet at the mall entrance at 4 pm?');
  END LOOP;
  CREATE TABLE public.u6_timing AS SELECT extract(epoch FROM clock_timestamp() - t0) * 1000 / 1000 AS ms_per_post;
END $$;
SQL

race() {   # race <name> <count> <sql with %N% replaced by the worker number>
  name=$1; n=$2; stmt=$3
  ( echo "SELECT pg_advisory_lock(4444);"; echo "\\! sleep 2"; echo "SELECT pg_advisory_unlock(4444);" ) | $Q >/dev/null &
  sleep 0.5
  i=1
  while [ $i -le $n ]; do
    s=$(echo "$stmt" | sed "s/%N%/$i/g")
    ( printf "SELECT pg_advisory_lock_shared(4444); SELECT pg_advisory_unlock_shared(4444) \\\\g /dev/null\n%s\n" "$s" \
        | $Q 2>&1 | grep -v '^$' > $OUT/$name.$i ) &
    i=$((i + 1))
  done
  wait
}
count() { cat $OUT/$1.* | grep -c -- "$2" || true; }

race post 20 "SELECT seq FROM chat.post('a6000000-0000-4000-8000-000000000001',
    CASE WHEN %N% % 2 = 0 THEN 'c0000000-0000-4000-8000-0000000000c1'::uuid ELSE 'c0000000-0000-4000-8000-0000000000c2' END,
    gen_random_uuid(), 'text', 'message %N%');"
race resend 10 "SELECT duplicate FROM chat.post('a6000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1',
    'f1000000-0000-4000-8000-00000000c0de', 'text', 'flaky network');"
race open 10 "SELECT chat.open_thread('e0000000-0000-4000-8000-000000000203', 'c0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-0000000000c2');"
race notify 10 "SELECT coalesce(notify.create('c0000000-0000-4000-8000-0000000000c1', 'order.paid', '{\"listing_title\":\"Used phone\"}', 'evt-race:order.paid')::text, 'duplicate');"
race claim 5 "SELECT count(*) FROM notify.claim_due_reminders(20);"
race mark 20 "SELECT chat.mark('a6000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-0000000000c1', %N%, %N% - 1);"

echo "Posting race: buyer and seller post 20 messages into one thread at once"
echo "  database: $($Q -c "SELECT 'messages=' || count(*) || ', seq ' || min(seq) || '..' || max(seq) || ', distinct seq=' || count(DISTINCT seq) FROM chat.messages WHERE thread_id = 'a6000000-0000-4000-8000-000000000001' AND body LIKE 'message %'")"
echo "Resend race: one message resent 10 times at once (same client id)"
echo "  results: stored $(count resend '^f$'), recognised as duplicates $(count resend '^t$')"
echo "Thread race: 10 requests open the same thread at once"
echo "  results: distinct thread ids returned $(cat $OUT/open.* | sort -u | wc -l)"
echo "  database: $($Q -c "SELECT 'threads=' || count(*) FROM chat.threads WHERE listing_id = 'e0000000-0000-4000-8000-000000000203' AND buyer_id = 'c0000000-0000-4000-8000-0000000000c1'")"
echo "Notification race: the same event consumed 10 times at once"
echo "  results: created $(($(cat $OUT/notify.* | wc -l) - $(count notify '^duplicate$'))), duplicates $(count notify '^duplicate$')"
echo "  database: $($Q -c "SELECT 'notifications=' || count(*) || ', deliveries=' || (SELECT count(*) FROM notify.deliveries d JOIN notify.notifications n ON n.id = d.notification_id WHERE n.dedupe_key = 'evt-race:order.paid') FROM notify.notifications WHERE dedupe_key = 'evt-race:order.paid'")"
echo "Reminder race: 5 job instances claim 50 due reminders at once (20 each at most)"
echo "  results: claimed $(cat $OUT/claim.* | awk '{s+=$1} END {print s}') in total"
echo "  database: $($Q -c "SELECT 'sent=' || count(*) FILTER (WHERE status = 'sent') || ', still scheduled=' || count(*) FILTER (WHERE status = 'scheduled') FROM notify.reminders WHERE kind = 'payment_window'")"
echo "Acknowledgement race: 20 acknowledgements (delivered N, read N-1) arriving at once"
echo "  database: $($Q -c "SELECT 'delivered=' || seller_delivered_seq || ', read=' || seller_read_seq || ', last=' || last_seq FROM chat.threads WHERE id = 'a6000000-0000-4000-8000-000000000003'")"
echo "Timing: chat.post inside the database, 1000 messages in one session"
echo "  $($Q -c "SELECT round(ms_per_post::numeric, 3) || ' ms per message (excluding network and commit)' FROM public.u6_timing")"; $Q -c "DROP TABLE public.u6_timing" >/dev/null
[ -n "$KEEP" ] && echo "kept $OUT" || rm -rf $OUT
