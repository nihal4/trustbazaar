#!/bin/sh
# Backup and restore of the combined database (Unit 9). For each of the Unit 4-7 concurrency scripts
# (each commits its own data, so each needs a fresh database): load the Unit 1-7 schemas and
# 09_integration.sql, run the script, dump with pg_dump (custom format), restore with pg_restore into a
# new database, and check that every table has the same number of rows and that the integration
# checks pass. After the last round, every unit's test script runs on the restored copy.
# Roles are cluster-wide and not part of pg_dump: tb_app must exist where the dump is restored.
# usage: PSQL="psql -h HOST -p PORT" PGBIN_OPTS="-h HOST -p PORT" sh 09_backup_restore_test.sh SQLDIR WORKDIR
set -e
DIR=${1:?directory with the SQL files}; WORK=${2:?writable directory}
PSQL=${PSQL:-psql}; O=${PGBIN_OPTS:-}
Q="$PSQL -X -q -v ON_ERROR_STOP=1"
SRC=tb_backup_src; DST=tb_backup_dst
COUNTS="SELECT string_agg(format('%s=%s', t, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %s', t), false, true, '')))[1]::text), ' ' ORDER BY t)
        FROM (SELECT c.oid::regclass::text t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE c.relkind = 'r' AND n.nspname IN ('identity','audit','orders','payments','listings','auctions','delivery',
                    'game_accounts','chat','notify','disputes','trust','staff')) x"
for data in seed 04_delivery 05_game_accounts 06_chat_notifications 07_disputes_trust_staff; do
  dropdb $O --if-exists $SRC; dropdb $O --if-exists $DST; createdb $O $SRC
  for n in 01_identity_access 02_orders_payments 03_listings_auctions 04_delivery 05_game_accounts \
           06_chat_notifications 07_disputes_trust_staff 09_integration; do
    $Q -d $SRC -f "$DIR/$n.sql" >/dev/null
  done
  [ "$data" = seed ] || PSQL="$PSQL" sh "$DIR/${data}_concurrency.sh" $SRC >/dev/null 2>&1
  before=$($Q -t -A -d $SRC -c "$COUNTS")
  pg_dump $O -Fc -d $SRC -f "$WORK/tb.dump"
  createdb $O $DST
  pg_restore $O --exit-on-error -d $DST "$WORK/tb.dump"
  after=$($Q -t -A -d $DST -c "$COUNTS")
  rows=$(echo "$before" | tr ' ' '\n' | awk -F= '{s+=$2} END {print s}')
  nonempty=$(echo "$before" | tr ' ' '\n' | awk -F= '$2>0' | wc -l)
  label="data of ${data}_concurrency.sh"; [ "$data" = seed ] && label="schema and seed data only"
  if [ "$before" = "$after" ]; then echo "PASS  $label: $rows rows in $nonempty tables identical after restore";
  else echo "FAIL  data of ${data}: row counts differ after restore"; exit 1; fi
  if $Q -t -d $DST -f "$DIR/09_integration_checks.sql" >/dev/null 2>&1; then echo "PASS  the integration checks pass on the restored copy";
  else echo "FAIL  integration checks on the restored copy"; exit 1; fi
  if [ "$data" = seed ]; then
    # the restored schema works: every unit's tests pass on it (each runs in a transaction and rolls back)
    for n in 01_identity_access 02_orders_payments 03_listings_auctions 04_delivery 05_game_accounts \
             06_chat_notifications 07_disputes_trust_staff; do
      out=$($Q -t -d $DST -f "$DIR/${n}_tests.sql" 2>&1 || true)
      p=$(echo "$out" | grep -c 'PASS' || true); f=$(echo "$out" | grep -c 'FAIL\|ERROR' || true)
      if [ "$f" -eq 0 ] && [ "$p" -gt 0 ]; then echo "PASS  $n tests on the restored copy ($p checks)";
      else echo "FAIL  $n tests on the restored copy ($p passed, $f failed)"; exit 1; fi
    done
  fi
done
dropdb $O $SRC; dropdb $O $DST; rm -f "$WORK/tb.dump"
