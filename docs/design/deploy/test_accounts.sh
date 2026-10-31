#!/bin/sh
# SEC-INF-03 tested on a real PostgreSQL: the container's init script creates the two accounts, the
# migrations run as tb_owner (no superuser), and tb_app can use the data but not change the schema.
# usage (as a superuser of a test cluster):
#   PGHOST=... PGPORT=... sh test_accounts.sh SQLDIR
set -eu
DIR=${1:?directory with the SQL files}
HERE=$(cd "$(dirname "$0")" && pwd)
DB=tb_deploy_check
pass=0; fail=0
ok()  { pass=$((pass + 1)); echo "PASS  $1"; }
bad() { fail=$((fail + 1)); echo "FAIL  $1"; }
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
psql -X -q -d postgres -c "DROP ROLE IF EXISTS tb_owner" >/dev/null 2>&1 || true
existing_app=$(psql -X -A -t -d postgres -c "SELECT count(*) FROM pg_roles WHERE rolname = 'tb_app'")
if [ "$existing_app" = 1 ]; then psql -X -q -d postgres -c "ALTER ROLE tb_app RENAME TO tb_app_keep" >/dev/null; fi

POSTGRES_USER=$(psql -X -A -t -d postgres -c "SELECT current_user") TB_OWNER_PASSWORD=owner-test-pw TB_APP_PASSWORD=app-test-pw \
  TB_DATABASE=$DB sh "$HERE/postgres/init/01_roles.sh" >/dev/null && ok "the init script creates tb_owner, tb_app and the database"

own="psql -X -q -v ON_ERROR_STOP=1 -U tb_owner -d $DB"
app="psql -X -q -v ON_ERROR_STOP=1 -U tb_app -d $DB"
export PGPASSWORD=owner-test-pw
loaded=1
for n in 01_identity_access 02_orders_payments 03_listings_auctions 04_delivery 05_game_accounts \
         06_chat_notifications 07_disputes_trust_staff 09_integration; do
  $own -f "$DIR/$n.sql" >/dev/null 2>"$HERE/.err" || { loaded=0; bad "migration $n as tb_owner: $(head -1 "$HERE/.err")"; }
done
[ $loaded = 1 ] && ok "all eight migrations run as tb_owner, which is not a superuser"
r=$(psql -X -A -t -U tb_owner -d $DB -c "SELECT rolsuper OR rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = 'tb_owner'")
[ "$r" = f ] && ok "tb_owner has no superuser, role or database rights" || bad "tb_owner rights"
r=$(psql -X -A -t -U tb_owner -d $DB -c "SELECT count(DISTINCT nspowner::regrole) FROM pg_namespace WHERE nspname IN ('identity','audit','orders','payments','listings','auctions','delivery','game_accounts','chat','notify','disputes','trust','staff') AND nspowner = 'tb_owner'::regrole")
[ "$r" = 1 ] && ok "tb_owner owns every unit schema" || bad "schema owner"

export PGPASSWORD=app-test-pw
$app -c "SELECT count(*) FROM identity.users" >/dev/null 2>&1 && ok "tb_app connects and reads" || bad "tb_app cannot read"
$app -c "BEGIN; INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at)
         VALUES ('Probe', '+8801711999999', now(), 'probe@tb.test', '\$argon2id\$v=19\$x', true, now()); ROLLBACK;" >/dev/null 2>&1 \
  && ok "tb_app writes data" || bad "tb_app cannot write"
r=$($app -A -t -c "BEGIN; INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at)
         VALUES ('Probe', '+8801711999998', now(), 'probe@tb.test', '\$argon2id\$v=19\$x', true, now());
         SELECT count(*) FROM identity.users WHERE email = 'PROBE@TB.TEST'; ROLLBACK;" 2>/dev/null | grep -x '[0-9]*')
[ "$r" = 1 ] && ok "tb_app compares citext case-insensitively (uses the extensions in public)" || bad "tb_app citext lookup found $r"
$app -c "BEGIN; INSERT INTO audit.events (actor_type, action) VALUES ('system', 'test.app_role.insert'); ROLLBACK;" >/dev/null 2>&1 \
  && ok "tb_app appends to the audit log (the chain trigger's digest() resolves)" || bad "tb_app cannot append to the audit log"
for stmt in "CREATE TABLE identity.x (a int)" "CREATE TABLE public.x (a int)" "ALTER TABLE identity.users ADD COLUMN x int" \
            "DROP TABLE trust.ratings" "CREATE SCHEMA x" "TRUNCATE chat.messages" "CREATE FUNCTION identity.f() RETURNS int LANGUAGE sql AS 'SELECT 1'" \
            "CREATE TEMP TABLE t (a int)" "DELETE FROM disputes.history" "UPDATE staff.config_values SET value = '1'"; do
  if $app -c "$stmt" >/dev/null 2>&1; then bad "tb_app could: $stmt"; else ok "tb_app is refused: $stmt"; fi
done
export PGPASSWORD=owner-test-pw
out=$($own -t -f "$DIR/09_integration_checks.sql" 2>&1) && ok "the integration checks pass on the database built this way" || bad "integration checks: $(echo "$out" | grep FAIL | head -2)"

psql -X -q -d postgres -c "DROP DATABASE $DB" >/dev/null
psql -X -q -d postgres -c "DROP ROLE tb_app; DROP ROLE tb_owner" >/dev/null
if [ "$existing_app" = 1 ]; then psql -X -q -d postgres -c "ALTER ROLE tb_app_keep RENAME TO tb_app" >/dev/null; fi
rm -f "$HERE/.err"
echo "$pass checks passed, $fail failed"
[ "$fail" -eq 0 ]
