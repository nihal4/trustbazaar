#!/bin/sh
# Negative control for 09_integration_checks.sql: a database with the Unit 1-7 schemas, WITHOUT
# 09_integration.sql, and one planted violation per rule. Every check must then report FAIL.
# usage: PSQL="psql -h HOST -p PORT -U USER" sh 09_integration_checks_selftest.sh DBNAME SQLDIR
set -e
DB=${1:?database}; DIR=${2:?directory with the unit SQL files}; PSQL=${PSQL:-psql}
Q="$PSQL -X -q -v ON_ERROR_STOP=1 -d $DB"
for n in 01_identity_access 02_orders_payments 03_listings_auctions 04_delivery 05_game_accounts \
         06_chat_notifications 07_disputes_trust_staff; do
  $Q -f "$DIR/$n.sql" >/dev/null
done
$Q >/dev/null <<'SQL'
CREATE SCHEMA misc;                                                                   -- unknown schema
CREATE TABLE public.stray (id int PRIMARY KEY);                                       -- object in public
ALTER TABLE identity.users ADD COLUMN probe uuid REFERENCES trust.reports(id);        -- DC-5: Unit 1 -> Unit 7
CREATE FUNCTION orders.peek() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM chat.messages';    -- DC-1 table
CREATE FUNCTION payments.quote() RETURNS void LANGUAGE plpgsql AS 'BEGIN PERFORM delivery.zone_at(1, 2); END';  -- DC-1 volatile call
CREATE FUNCTION trust.ping() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
CREATE TRIGGER ping BEFORE INSERT ON chat.blocks FOR EACH ROW EXECUTE FUNCTION trust.ping();          -- another unit's trigger
CREATE TABLE trust.no_key (a int);                                                    -- no primary key
CREATE FUNCTION staff.dyn(t text) RETURNS bigint LANGUAGE plpgsql AS 'DECLARE n bigint; BEGIN EXECUTE ''SELECT count(*) FROM '' || t INTO n; RETURN n; END';  -- dynamic SQL
ALTER TABLE listings.listings ADD COLUMN score double precision;                     -- float
ALTER TABLE payments.refunds ADD COLUMN extra_fee numeric;                           -- money not bigint
CREATE TABLE notify.outbox (id bigint PRIMARY KEY, event_type text);                 -- second outbox for Unit 6
ALTER TABLE delivery.outbox DROP CONSTRAINT IF EXISTS outbox_event_type_check;
ALTER TABLE delivery.outbox ADD CONSTRAINT outbox_event_type_check CHECK (event_type ~ '^(delivery|orders)\.[a-z_]+\.[a-z_]+$');  -- foreign prefix
CREATE FUNCTION trust.misfire() RETURNS void LANGUAGE sql AS
  $$ INSERT INTO disputes.outbox (event_type, aggregate_id, payload) VALUES ('orders.order.paid', gen_random_uuid(), '{}') $$;   -- foreign event
GRANT TRUNCATE ON chat.messages TO tb_app;
GRANT DELETE ON disputes.history TO tb_app;                                          -- append-only table
ALTER ROLE tb_app CREATEDB;
CREATE TABLE staff.owned (id int PRIMARY KEY); ALTER TABLE staff.owned OWNER TO tb_app;
CREATE SCHEMA IF NOT EXISTS trust; REVOKE USAGE ON SCHEMA staff FROM tb_app;
SQL
OUT=$($Q -t -f "$DIR/09_integration_checks.sql" 2>&1 || true)
$Q -c "ALTER ROLE tb_app NOCREATEDB" >/dev/null           # the role is cluster-wide: undo
fails=$(echo "$OUT" | grep -c 'FAIL  ' || true)
passes=$(echo "$OUT" | grep -c 'PASS  ' || true)
echo "$OUT" | grep -o 'FAIL  .* : ' | sed 's/ : $//'
echo "negative control: $fails checks failed, $passes passed (expected: all fail, none pass)"
[ "$passes" -eq 0 ]
