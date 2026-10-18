-- Checks of the combined schema (Unit 9). Run after all seven unit schemas and 09_integration.sql:
--   psql -v ON_ERROR_STOP=1 -f 09_integration_checks.sql
-- Reads the catalogue only; changes nothing. Each check prints PASS, or FAIL with the offenders.
SET client_min_messages = notice;

CREATE TEMP TABLE unit_schema (s name PRIMARY KEY, unit int NOT NULL);
INSERT INTO unit_schema VALUES ('identity',1),('audit',1),('orders',2),('payments',2),('listings',3),('auctions',3),
  ('delivery',4),('game_accounts',5),('chat',6),('notify',6),('disputes',7),('trust',7),('staff',7);
CREATE TEMP TABLE failures (n int);

CREATE FUNCTION pg_temp.check(label text, offenders text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(cardinality(offenders), 0) = 0 THEN RAISE NOTICE 'PASS  %', label;
  ELSE
    RAISE NOTICE 'FAIL  % : %', label, array_to_string(offenders[1:12], ', ');
    INSERT INTO failures VALUES (1);
  END IF;
END $$;

-- ---------------------------------------------------------------- where objects live
SELECT pg_temp.check('every schema outside the system belongs to one unit',
  array(SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname NOT IN ('information_schema', 'public')
        AND nspname NOT IN (SELECT s FROM unit_schema)));
SELECT pg_temp.check('nothing of the design is in the public schema (extension objects aside)',
  array(SELECT c.oid::regclass::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
        UNION ALL
        SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')));

-- ---------------------------------------------------------------- DC-5 and DC-1 across units
SELECT pg_temp.check('DC-5 every foreign key points to its own unit or an earlier one',
  array(SELECT format('%s -> %s', c.conrelid::regclass, c.confrelid::regclass)
        FROM pg_constraint c
        JOIN pg_class a ON a.oid = c.conrelid JOIN unit_schema ua ON ua.s = a.relnamespace::regnamespace::name
        JOIN pg_class b ON b.oid = c.confrelid JOIN unit_schema ub ON ub.s = b.relnamespace::regnamespace::name
        WHERE c.contype = 'f' AND ub.unit > ua.unit));

CREATE TEMP TABLE cross_refs AS
  SELECT us.unit AS from_unit, n.nspname AS from_schema, p.proname, m[1] AS ref_schema, m[2] AS ref_name, ur.unit AS to_unit
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN unit_schema us ON us.s = n.nspname,
       regexp_matches(p.prosrc, '\m(identity|audit|orders|payments|listings|auctions|delivery|game_accounts|chat|notify|disputes|trust|staff)\.([a-z_]+)', 'g') m,
       unit_schema ur
  WHERE ur.s = m[1] AND ur.unit <> us.unit;
SELECT pg_temp.check('DC-1 no function reads or writes another unit''s tables',
  array(SELECT DISTINCT format('%s.%s uses %s.%s', from_schema, proname, ref_schema, ref_name) FROM cross_refs r
        WHERE EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = r.ref_schema AND c.relname = r.ref_name)));
SELECT pg_temp.check('DC-1 a function of another unit is called only if it is IMMUTABLE (a pure calculation)',
  array(SELECT DISTINCT format('%s.%s calls %s.%s', r.from_schema, r.proname, r.ref_schema, r.ref_name) FROM cross_refs r
        JOIN pg_proc p ON p.proname = r.ref_name AND p.pronamespace = r.ref_schema::regnamespace
        WHERE p.provolatile <> 'i'));
SELECT pg_temp.check('triggers run their own unit''s functions, or the shared identity.forbid_change',
  array(SELECT format('%s runs %s', t.tgrelid::regclass, t.tgfoid::regproc)
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN unit_schema u1 ON u1.s = c.relnamespace::regnamespace::name
        JOIN pg_proc p ON p.oid = t.tgfoid JOIN unit_schema u2 ON u2.s = p.pronamespace::regnamespace::name
        WHERE NOT t.tgisinternal AND u1.unit <> u2.unit AND t.tgfoid <> 'identity.forbid_change'::regproc));

-- ---------------------------------------------------------------- shape of the data
SELECT pg_temp.check('every table has a primary key',
  array(SELECT c.oid::regclass::text FROM pg_class c JOIN unit_schema u ON u.s = c.relnamespace::regnamespace::name
        WHERE c.relkind = 'r' AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p')));
SELECT pg_temp.check('every time is a timestamptz; no float or money types anywhere',
  array(SELECT format('%s.%s.%s %s', table_schema, table_name, column_name, data_type) FROM information_schema.columns
        WHERE table_schema IN (SELECT s FROM unit_schema)
          AND data_type IN ('timestamp without time zone', 'time without time zone', 'real', 'double precision', 'money')));
SELECT pg_temp.check('every amount of money is a bigint of poisha',
  array(SELECT format('%s.%s.%s %s', c.table_schema, c.table_name, c.column_name, c.data_type)
        FROM information_schema.columns c JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE t.table_type = 'BASE TABLE' AND c.table_schema IN (SELECT s FROM unit_schema)
          AND c.column_name ~ '(price|amount|fee|refund|fare|payout|collected|released|receivable)'
          AND c.column_name !~ '(_bps|_at|_id|_by|_version|_reason|_kind|_status|_payer|_key)$'
          AND c.data_type <> 'bigint'));

SELECT pg_temp.check('SEC-INP-02 no database function builds SQL at run time (no EXECUTE)',
  array(SELECT n.nspname || '.' || p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN unit_schema u ON u.s = n.nspname WHERE p.prosrc ~* '\mEXECUTE\M'));

-- ---------------------------------------------------------------- events (DC-6)
SELECT pg_temp.check('each unit has exactly one outbox',
  array(SELECT format('unit %s has %s', u.unit, count(c.oid)) FROM (SELECT DISTINCT unit FROM unit_schema) u
        LEFT JOIN unit_schema us ON us.unit = u.unit
        LEFT JOIN pg_class c ON c.relnamespace = us.s::regnamespace AND c.relname = 'outbox' AND c.relkind = 'r'
        GROUP BY u.unit HAVING count(c.oid) <> 1));
SELECT pg_temp.check('each outbox accepts only its own unit''s event names',
  array(SELECT format('%s: %s', c.conrelid::regclass, pg_get_constraintdef(c.oid))
        FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid AND t.relname = 'outbox'
        JOIN unit_schema u ON u.s = t.relnamespace::regnamespace::name
        WHERE c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%event_type%'
          AND EXISTS (SELECT 1 FROM unit_schema o WHERE o.unit <> u.unit
                      AND pg_get_constraintdef(c.oid) ~ ('[\^(|]' || o.s || '[\\|)]'))));
SELECT pg_temp.check('every event name written by a function is <unit>.<entity>.<past> of its own unit',
  array(SELECT DISTINCT format('%s.%s writes %s', n.nspname, p.proname, m[1])
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN unit_schema u ON u.s = n.nspname,
             regexp_matches(p.prosrc, '''([a-z_]+\.[a-z_]+\.[a-z_]+)''', 'g') m
        WHERE split_part(m[1], '.', 1) NOT IN (SELECT s FROM unit_schema WHERE unit = u.unit)));

-- ---------------------------------------------------------------- indexes (DC-15)
SELECT pg_temp.check('DC-15 every foreign key into a table the application may delete from has an index',
  array(SELECT format('%s (%s)', c.conrelid::regclass, c.conname) FROM pg_constraint c
        WHERE c.contype = 'f' AND has_table_privilege('tb_app', c.confrelid, 'DELETE')
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                          AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)));
SELECT pg_temp.check('DC-15 the foreign keys that queries look up by have their indexes (09_integration.sql)',
  array(SELECT x FROM unnest(ARRAY['identity.otp_challenges_pending', 'identity.staff_conflicts_user', 'identity.kyc_history_submission',
        'identity.recovery_codes_factor', 'payments.refunds_attempt', 'payments.refunds_order', 'payments.provider_events_attempt',
        'payments.payouts_seller', 'payments.chargebacks_attempt', 'listings.clarifications_listing', 'listings.status_history_listing',
        'auctions.auction_strikes_user', 'auctions.auction_flags_auction', 'auctions.second_chance_bidder', 'game_accounts.claims_order',
        'chat.staff_access_thread', 'disputes.statements_dispute', 'disputes.evidence_dispute', 'disputes.disputes_buyer',
        'disputes.disputes_seller', 'trust.reports_subject', 'trust.signals_subject', 'trust.eligibility_buyer',
        'trust.eligibility_seller']) x WHERE to_regclass(x) IS NULL));
SELECT pg_temp.check('rows other tables point to without an index are never deleted by the application',
  array(SELECT DISTINCT c.confrelid::regclass::text FROM pg_constraint c
        WHERE c.contype = 'f' AND has_table_privilege('tb_app', c.confrelid, 'DELETE')
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                          AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)));

-- ---------------------------------------------------------------- the application role
SELECT pg_temp.check('tb_app is an ordinary login role: no superuser, role, database or RLS-bypass rights',
  array(SELECT rolname FROM pg_roles WHERE rolname = 'tb_app' AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)));
SELECT pg_temp.check('tb_app owns nothing, so it cannot alter or drop any table',
  array(SELECT c.oid::regclass::text FROM pg_class c WHERE c.relowner = 'tb_app'::regrole));
SELECT pg_temp.check('tb_app has no TRUNCATE, TRIGGER or REFERENCES right on any table',
  array(SELECT format('%s.%s %s', table_schema, table_name, privilege_type) FROM information_schema.role_table_grants
        WHERE grantee = 'tb_app' AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')));
SELECT pg_temp.check('append-only tables: tb_app may not delete from any table guarded against deletion',
  array(SELECT DISTINCT t.tgrelid::regclass::text FROM pg_trigger t
        WHERE t.tgfoid = 'identity.forbid_change'::regproc AND (t.tgtype & 8) <> 0
          AND has_table_privilege('tb_app', t.tgrelid, 'DELETE')));
SELECT pg_temp.check('tb_app can use every unit schema',
  array(SELECT s FROM unit_schema WHERE NOT has_schema_privilege('tb_app', s, 'USAGE')));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM failures) THEN RAISE EXCEPTION 'integration checks failed'; END IF;
END $$;
