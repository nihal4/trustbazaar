-- Tests for the database-enforced rules of Unit 5 (Game-Account Escrow). Run after the Unit 1-5
-- schemas:  psql -v ON_ERROR_STOP=1 -f 05_game_accounts_tests.sql
-- Each rejection must name the intended rule. One transaction, rolled back, so it can be rerun.
-- now() is constant inside it; the window-end job uses the statement clock, so two checks wait
-- briefly with pg_sleep.
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
-- a fake but well-formed P-256 point and HPKE output (the database cannot and must not decrypt)
CREATE FUNCTION pg_temp.pt(n int) RETURNS bytea LANGUAGE sql AS $$ SELECT '\x04'::bytea || decode(repeat(lpad(to_hex(n), 2, '0'), 64), 'hex') $$;
CREATE FUNCTION pg_temp.ct(blocks int) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(repeat('5a', 512 * blocks + 16), 'hex') $$;

-- ---------------------------------------------------------------- fixtures
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash) VALUES
 ('a0000000-0000-4000-8000-000000000001', 'admin@tb.test', 'Admin', 'administrator', 'active', '$argon2id$v=19$x');
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash, created_by) VALUES
 ('b0000000-0000-4000-8000-000000000001', 'op@tb.test', 'Operator', 'operator', 'active', '$argon2id$v=19$x', 'a0000000-0000-4000-8000-000000000001');
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-000000000001', 'Buyer',    '+8801711000001', now(), 'b@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000002', 'Seller',   '+8801811000002', now(), 's@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000003', 'Stranger', '+8801911000003', now(), 'x@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000004', 'Seller2',  '+8801611000004', now(), 's2@tb.test', '$argon2id$v=19$x', true, now());
INSERT INTO identity.sessions (id, principal_type, user_id, idle_expires_at, absolute_expires_at) VALUES
 ('e5000000-0000-4000-8000-000000000001', 'user', 'c0000000-0000-4000-8000-000000000001', now() + interval '7 days', now() + interval '30 days'),
 ('e5000000-0000-4000-8000-000000000002', 'user', 'c0000000-0000-4000-8000-000000000001', now() + interval '7 days', now() + interval '30 days');
INSERT INTO listings.categories (id, slug, name_en, name_bn, item_kind, prohibited) OVERRIDING SYSTEM VALUE VALUES
 (301, 'game-accounts-u5', 'Game accounts', 'গেম অ্যাকাউন্ট', 'game_account', false);
INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, price)
SELECT ('e0000000-0000-4000-8000-00000000000' || n)::uuid,
       CASE WHEN n = 4 THEN 'c0000000-0000-4000-8000-000000000004'::uuid ELSE 'c0000000-0000-4000-8000-000000000002' END,
       'game_account', 'fixed_price', 301, 'Level 70 account', 'An account with many skins and rare items.', 500000
  FROM generate_series(1, 6) n;
INSERT INTO game_accounts.games (id, slug, name, platforms, code_placement, publisher_note) OVERRIDING SYSTEM VALUE VALUES
 (1, 'pubg-mobile', 'PUBG Mobile', ARRAY['android', 'ios'], 'Signature on the profile page',
  'The publisher''s terms do not allow account transfers; the account may be banned.');

-- paid game-account order (Unit 2 rules)
CREATE FUNCTION pg_temp.game_order(p_id uuid, p_listing uuid, p_seller uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO orders.orders (id, kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price,
      fulfilment, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
  VALUES (p_id, 'fixed_price', p_listing, 'game_account', 'c0000000-0000-4000-8000-000000000001', p_seller,
      1, 500000, 500000, 'game_account', 0, 500000, '{}', 500, 1000, 1, now() + interval '15 minutes')
$$;
-- a handover ready for payment, then paid; returns nothing
CREATE FUNCTION pg_temp.paid_handover(p_order uuid, p_listing uuid, p_due timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.game_order(p_order, p_listing, 'c0000000-0000-4000-8000-000000000002');
  INSERT INTO game_accounts.handovers (order_id, listing_id, buyer_id, seller_id, disclosure_version)
  VALUES (p_order, p_listing, 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1);
  PERFORM game_accounts.register_key(p_order, 'c0000000-0000-4000-8000-000000000001', pg_temp.pt(1), 'e5000000-0000-4000-8000-000000000001');
  PERFORM game_accounts.mark_paid(p_order, p_due);
END $$;

-- ---------------------------------------------------------------- listing details (FR-GAM-02)
INSERT INTO game_accounts.details (listing_id, seller_id, game_id, platform, player_id, contents)
SELECT ('e0000000-0000-4000-8000-00000000000' || n)::uuid,
       CASE WHEN n = 4 THEN 'c0000000-0000-4000-8000-000000000004'::uuid ELSE 'c0000000-0000-4000-8000-000000000002' END,
       1, 'android', CASE WHEN n = 1 THEN '51234567' WHEN n = 4 THEN ' 5123 4567 ' ELSE '5123' || n || '4567' END, 'Level 70, Glacier M416, Conqueror frame.'
  FROM generate_series(1, 6) n;
SELECT pg_temp.expect_fail('FR-GAM-02 the platform must be one the game offers',
 $q$UPDATE game_accounts.details SET platform = 'xbox' WHERE listing_id = 'e0000000-0000-4000-8000-000000000001'$q$, 'is not offered for this game');
SELECT pg_temp.ok('player IDs are compared without spaces and case',
  (SELECT player_id_norm FROM game_accounts.details WHERE listing_id = 'e0000000-0000-4000-8000-000000000004') = '51234567');

-- ---------------------------------------------------------------- ownership proof (FR-GAM-03)
SELECT pg_temp.expect_fail('DV-33 ownership codes have the fixed format',
 $q$INSERT INTO game_accounts.ownership_proofs (listing_id, code, expires_at) VALUES ('e0000000-0000-4000-8000-000000000001', 'TB-ILOU-0000', now() + interval '7 days')$q$, 'ownership_proofs_code_check');
INSERT INTO game_accounts.ownership_proofs (id, listing_id, code, expires_at) VALUES
 ('f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'TB-7K4Q-9XWM', now() + interval '7 days');
SELECT pg_temp.expect_fail('one open ownership proof per listing',
 $q$INSERT INTO game_accounts.ownership_proofs (listing_id, code, expires_at) VALUES ('e0000000-0000-4000-8000-000000000001', 'TB-AAAA-BBBB', now() + interval '7 days')$q$, 'proof_one_open');
SELECT pg_temp.expect_fail('a proof cannot be reviewed before the screenshot is submitted',
 $q$SELECT game_accounts.review_proof('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', true, 'matched', NULL)$q$, 'not awaiting review');
SELECT pg_temp.expect_fail('submitting needs the screenshot',
 $q$UPDATE game_accounts.ownership_proofs SET status = 'submitted', submitted_at = now() WHERE id = 'f0000000-0000-4000-8000-000000000001'$q$, 'proof_submitted_fields');
UPDATE game_accounts.ownership_proofs SET status = 'submitted', submitted_at = now(), screenshot_key = 'ev-1',
       screenshot_dek = '\x01', screenshot_sha256 = sha256('\x01') WHERE id = 'f0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_fail('the game and player ID are fixed once proof is submitted',
 $q$UPDATE game_accounts.details SET player_id = '99999999' WHERE listing_id = 'e0000000-0000-4000-8000-000000000001'$q$, 'fixed once ownership proof');
SELECT pg_temp.expect_fail('an operator cannot approve a proof whose live profile did not match',
 $q$SELECT game_accounts.review_proof('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', true, 'not_matched', NULL)$q$, 'proof_approve_live');
SELECT pg_temp.expect_fail('FR-GAM-03 a rejection needs a reason',
 $q$SELECT game_accounts.review_proof('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', false, 'not_available', 'no')$q$, 'proof_reject_reason');
SELECT pg_temp.ok('FR-GAM-03 approval records the operator and takes the player-ID claim',
  game_accounts.review_proof('f0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', true, 'matched', NULL) = 'approved');
SELECT pg_temp.ok('... claim and event written',
  EXISTS (SELECT 1 FROM game_accounts.claims WHERE listing_id = 'e0000000-0000-4000-8000-000000000001' AND released_at IS NULL)
  AND EXISTS (SELECT 1 FROM game_accounts.outbox WHERE event_type = 'game_accounts.ownership.approved'));
SELECT pg_temp.expect_fail('a reviewed proof is final',
 $q$UPDATE game_accounts.ownership_proofs SET live_check = 'not_available' WHERE id = 'f0000000-0000-4000-8000-000000000001'$q$, 'reviewed proof is final');
-- a second seller lists the same player ID (written with spaces)
INSERT INTO game_accounts.ownership_proofs (id, listing_id, code, expires_at, status) VALUES
 ('f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000004', 'TB-2222-3333', now() + interval '7 days', 'issued');
UPDATE game_accounts.ownership_proofs SET status = 'submitted', submitted_at = now(), screenshot_key = 'ev-4',
       screenshot_dek = '\x01', screenshot_sha256 = sha256('\x02') WHERE id = 'f0000000-0000-4000-8000-000000000004';
SELECT pg_temp.expect_fail('FR-GAM-04 one live listing per game and player ID: the second approval is refused',
 $q$SELECT game_accounts.review_proof('f0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000001', true, 'matched', NULL)$q$,
 'already listed');
INSERT INTO game_accounts.ownership_proofs (id, listing_id, code, issued_at, expires_at) VALUES
 ('f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000005', 'TB-5555-6666', now() - interval '8 days', now() - interval '1 day');
UPDATE game_accounts.ownership_proofs SET status = 'submitted', submitted_at = now(), screenshot_key = 'ev-5',
       screenshot_dek = '\x01', screenshot_sha256 = sha256('\x03') WHERE id = 'f0000000-0000-4000-8000-000000000005';
SELECT pg_temp.expect_fail('DV-33 an expired code cannot be approved',
 $q$SELECT game_accounts.review_proof('f0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000001', true, 'matched', NULL)$q$, 'has expired');

-- ---------------------------------------------------------------- checkout (FR-GAM-05, FR-GAM-07)
SELECT pg_temp.game_order('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002');
SELECT pg_temp.expect_fail('FR-GAM-07 no key before the disclosure is acknowledged',
 $q$SELECT game_accounts.register_key('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', pg_temp.pt(1), 'e5000000-0000-4000-8000-000000000001')$q$, 'acknowledge the disclosure first');
SELECT pg_temp.expect_fail('a handover starts as preparing, without a key',
 $q$INSERT INTO game_accounts.handovers (order_id, listing_id, buyer_id, seller_id, disclosure_version, status) VALUES ('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 'delivered')$q$,
 'starts as preparing');
INSERT INTO game_accounts.handovers (order_id, listing_id, buyer_id, seller_id, disclosure_version)
VALUES ('d0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1);
SELECT pg_temp.ok('FR-GAM-05 with the disclosure acknowledged but no key, checkout is not ready',
  NOT game_accounts.checkout_ready('d0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('FR-GAM-07 a public key must be an uncompressed P-256 point',
 $q$SELECT game_accounts.register_key('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', '\x02'::bytea || decode(repeat('01', 32), 'hex'), 'e5000000-0000-4000-8000-000000000001')$q$, 'buyer_keys_public_key_check');
SELECT pg_temp.expect_fail('only the buyer registers a key',
 $q$SELECT game_accounts.register_key('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', pg_temp.pt(1), 'e5000000-0000-4000-8000-000000000001')$q$, 'only the buyer');
SELECT pg_temp.ok('FR-GAM-07 key version 1 registered; checkout is ready',
  game_accounts.register_key('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', pg_temp.pt(1), 'e5000000-0000-4000-8000-000000000001') = 1);
SELECT pg_temp.ok('... ready', game_accounts.checkout_ready('d0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('the key cannot be swapped once registered',
 $q$SELECT game_accounts.register_key('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', pg_temp.pt(9), 'e5000000-0000-4000-8000-000000000001')$q$, 'key is fixed at checkout');
SELECT pg_temp.expect_fail('buyer keys are append-only',
 $q$UPDATE game_accounts.buyer_keys SET public_key = pg_temp.pt(9)$q$, 'append-only');
SELECT pg_temp.ok('FR-GAM-08 fingerprint test vector (first 80 bits of SHA-256 of the raw key)',
  game_accounts.fingerprint('\x04'::bytea || decode('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40', 'hex'))
  = '0ed3-a6ab-957f-f6f5-9a96');

-- ---------------------------------------------------------------- credential delivery (FR-GAM-09, FR-GAM-10)
SELECT pg_temp.expect_fail('FR-GAM-10 credentials are not accepted before payment',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours')$q$, 'not expected now');
SELECT game_accounts.mark_paid('d0000000-0000-4000-8000-000000000001', now() + interval '24 hours');
SELECT pg_temp.expect_fail('only the seller delivers',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours')$q$, 'only the seller');
SELECT pg_temp.expect_fail('ciphertext must be sealed for the buyer''s current key',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 2::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours')$q$, 'current key is version 1');
SELECT pg_temp.expect_fail('DV-34 an unpadded ciphertext length is refused',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), decode(repeat('5a', 600), 'hex'), interval '24 hours')$q$, 'sealed_credentials_ciphertext_check');
SELECT pg_temp.expect_fail('DV-34 the payload is at most 4 KB',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(9), interval '24 hours')$q$, 'sealed_credentials_ciphertext_check');
SELECT pg_temp.expect_fail('the encapsulated key must be a P-256 point',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1::smallint, '\x0102'::bytea, pg_temp.ct(1), interval '24 hours')$q$, 'sealed_credentials_enc_check');
SELECT pg_temp.ok('FR-GAM-09 the first delivery is the fulfilment step and starts the CP-23 window',
  game_accounts.deliver('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours'));
SELECT pg_temp.ok('... window ends 24 hours after delivery',
  (SELECT status = 'delivered' AND takeover_due_at = delivered_at + interval '24 hours' FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('credentials are delivered once (no second ciphertext without a re-key)',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours')$q$, 'not expected now');
SELECT pg_temp.expect_fail('sealed credentials cannot be altered, only deleted',
 $q$UPDATE game_accounts.sealed_credentials SET ciphertext = pg_temp.ct(2)$q$, 'can only be deleted');
SELECT pg_temp.paid_handover('d0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', now() - interval '1 minute');
SELECT pg_temp.expect_fail('FR-GAM-10 nothing is accepted after the CP-22 deadline',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours')$q$, 'deadline has passed');

-- ---------------------------------------------------------------- retrieval (FR-GAM-11)
SELECT pg_temp.expect_fail('FR-GAM-11 only the buyer of the order can retrieve the ciphertext',
 $q$SELECT * FROM game_accounts.fetch_sealed('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', '10.0.0.1')$q$, 'only the buyer');
SELECT * FROM game_accounts.fetch_sealed('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', '10.0.0.1') \g /dev/null
SELECT * FROM game_accounts.fetch_sealed('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', '10.0.0.2') \g /dev/null
SELECT pg_temp.ok('FR-GAM-11 every retrieval is logged with user, session and time',
  (SELECT count(*) = 2 AND count(DISTINCT session_id) = 2 FROM game_accounts.access_log WHERE order_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('SEC-GAM-02 the access log is append-only',
 $q$DELETE FROM game_accounts.access_log$q$, 'append-only');

-- ---------------------------------------------------------------- takeover (FR-GAM-13 to FR-GAM-15)
SELECT pg_temp.expect_fail('only the buyer confirms takeover steps',
 $q$SELECT game_accounts.confirm_step('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'password', 'e5000000-0000-4000-8000-000000000001')$q$, 'only the buyer');
SELECT pg_temp.ok('FR-GAM-13 confirming the password step does not complete the takeover',
  NOT game_accounts.confirm_step('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'password', 'e5000000-0000-4000-8000-000000000001'));
SELECT game_accounts.confirm_step('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'recovery_email', 'e5000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_fail('FR-GAM-14 after the recovery e-mail step, credentials_invalid is refused',
 $q$SELECT game_accounts.report_invalid('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001')$q$, 'no longer accepted');
SELECT pg_temp.expect_fail('FR-GAM-12 no re-key after the recovery e-mail step',
 $q$SELECT game_accounts.request_rekey('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', pg_temp.pt(3), 'e5000000-0000-4000-8000-000000000001', interval '24 hours')$q$, 'already controls the recovery e-mail');
SELECT pg_temp.ok('a step confirmed twice is recorded once',
  NOT game_accounts.confirm_step('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'password', 'e5000000-0000-4000-8000-000000000002')
  AND (SELECT count(*) FROM game_accounts.confirmations WHERE order_id = 'd0000000-0000-4000-8000-000000000001' AND step = 'password') = 1);
SELECT pg_temp.expect_fail('a confirmed step cannot be undone',
 $q$UPDATE game_accounts.handovers SET pw_changed_at = NULL WHERE order_id = 'd0000000-0000-4000-8000-000000000001'$q$, 'fixed once recorded');
SELECT game_accounts.confirm_step('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', s, 'e5000000-0000-4000-8000-000000000001')
  FROM unnest(ARRAY['recovery_phone', 'social_logins']::game_accounts.takeover_step[]) s \g /dev/null
SELECT game_accounts.confirm_step('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'two_step', 'e5000000-0000-4000-8000-000000000001') AS r \gset
SELECT pg_temp.ok('FR-GAM-15 the fifth step completes the takeover (the delivery event), source checklist',
  :'r'::boolean AND (SELECT status = 'taken_over' AND takeover_source = 'checklist' AND taken_over_at = now()
                       FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('a completed takeover cannot be cancelled',
 $q$UPDATE game_accounts.handovers SET status = 'cancelled', cancelled_at = now() WHERE order_id = 'd0000000-0000-4000-8000-000000000001'$q$, 'is not permitted');

-- window end with no action (FR-GAM-15)
SELECT pg_temp.paid_handover('d0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000003', now() + interval '24 hours');
SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '1 second');
SELECT pg_temp.ok('before the window ends, the job does nothing',
  game_accounts.complete_if_due('d0000000-0000-4000-8000-000000000003') IS NULL);
SELECT pg_sleep(1.2);
SELECT game_accounts.complete_if_due('d0000000-0000-4000-8000-000000000003') AS done_at \gset
SELECT pg_temp.ok('FR-GAM-15 at the window end the takeover is treated as complete, at the end time',
  :'done_at'::timestamptz = now() + interval '1 second'
  AND (SELECT status = 'taken_over' AND takeover_source = 'window_end' FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000003'));

-- report invalid inside the window (FR-GAM-14), then withdrawal
SELECT pg_temp.paid_handover('d0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000005', now() + interval '24 hours');
SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours');
SELECT game_accounts.confirm_step('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'password', 'e5000000-0000-4000-8000-000000000001');
SELECT game_accounts.report_invalid('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001');
SELECT pg_temp.ok('FR-GAM-14 a credentials_invalid report inside the window opens the dispute path',
  (SELECT status = 'disputed' FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000004')
  AND EXISTS (SELECT 1 FROM game_accounts.outbox WHERE event_type = 'game_accounts.credentials.reported_invalid'));
SELECT pg_temp.expect_fail('while disputed, no step can be confirmed',
 $q$SELECT game_accounts.confirm_step('d0000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'two_step', 'e5000000-0000-4000-8000-000000000001')$q$, 'not in progress');
SELECT pg_temp.ok('while disputed, the window-end job cannot complete the takeover',
  game_accounts.complete_if_due('d0000000-0000-4000-8000-000000000004') IS NULL);
SELECT game_accounts.dispute_withdrawn('d0000000-0000-4000-8000-000000000004');
SELECT pg_temp.ok('FR-DSP-10 a withdrawn dispute resumes the takeover window',
  (SELECT status = 'delivered' AND takeover_due_at > now() FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000004'));
SELECT pg_temp.expect_fail('a checklist completion needs all five confirmations',
 $q$UPDATE game_accounts.handovers SET status = 'taken_over', taken_over_at = now(), takeover_source = 'checklist' WHERE order_id = 'd0000000-0000-4000-8000-000000000004'$q$, 'checklist_complete');

-- re-key (FR-GAM-12)
SELECT pg_temp.paid_handover('d0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-000000000006', now() + interval '24 hours');
SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours');
SELECT pg_temp.ok('FR-GAM-12 a re-key issues key version 2 and stops the window',
  game_accounts.request_rekey('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', pg_temp.pt(3), 'e5000000-0000-4000-8000-000000000002', interval '24 hours') = 2);
SELECT pg_temp.ok('... status rekey_requested, no window, re-delivery deadline set',
  (SELECT status = 'rekey_requested' AND takeover_due_at IS NULL AND rekey_due_at = now() + interval '24 hours'
     FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000005'));
SELECT pg_temp.expect_fail('the seller must seal for the new key, not the old one',
 $q$SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours')$q$, 'current key is version 2');
SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 2::smallint, pg_temp.pt(4), pg_temp.ct(2), interval '24 hours') AS first \gset
SELECT pg_temp.ok('FR-GAM-12 re-delivery restarts the window and is not a second fulfilment step',
  NOT :'first'::boolean
  AND (SELECT status = 'delivered' AND takeover_due_at = now() + interval '24 hours' FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000005'));
SELECT pg_temp.ok('the old ciphertext is deleted on re-delivery; only version 2 can be retrieved',
  (SELECT count(*) FILTER (WHERE deleted_at IS NULL) = 1 AND bool_and(deleted_at IS NOT NULL OR key_version = 2)
     FROM game_accounts.sealed_credentials WHERE order_id = 'd0000000-0000-4000-8000-000000000005'));
SELECT pg_temp.expect_fail('FR-GAM-12 only one re-key per order',
 $q$SELECT game_accounts.request_rekey('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', pg_temp.pt(5), 'e5000000-0000-4000-8000-000000000001', interval '24 hours')$q$, 'one re-key has been used');

-- re-key not answered in time (DV-37)
SELECT pg_temp.paid_handover('d0000000-0000-4000-8000-000000000006', 'e0000000-0000-4000-8000-000000000002', now() + interval '24 hours');
SELECT game_accounts.deliver('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002', 1::smallint, pg_temp.pt(2), pg_temp.ct(1), interval '24 hours');
SELECT game_accounts.request_rekey('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', pg_temp.pt(3), 'e5000000-0000-4000-8000-000000000002', interval '1 second');
SELECT pg_sleep(1.2);
SELECT pg_temp.ok('DV-37 a re-key the seller does not answer in time becomes a dispute',
  game_accounts.rekey_overdue('d0000000-0000-4000-8000-000000000006'));
SELECT pg_temp.ok('... status disputed', (SELECT status = 'disputed' FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000006'));

-- ---------------------------------------------------------------- end of the handover (FR-GAM-19, FR-GAM-04)
SELECT game_accounts.finish('d0000000-0000-4000-8000-000000000001', false);
SELECT pg_temp.ok('FR-GAM-19 at the terminal escrow state the ciphertext is deleted and the access log kept',
  (SELECT bool_and(deleted_at IS NOT NULL AND ciphertext IS NULL AND enc IS NULL) FROM game_accounts.sealed_credentials WHERE order_id = 'd0000000-0000-4000-8000-000000000001')
  AND (SELECT count(*) = 2 FROM game_accounts.access_log WHERE order_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('FR-GAM-04 after the protection period the player ID can be listed again',
  NOT EXISTS (SELECT 1 FROM game_accounts.claims WHERE listing_id = 'e0000000-0000-4000-8000-000000000001' AND released_at IS NULL));
SELECT pg_temp.expect_fail('after closing, nothing can be retrieved',
 $q$SELECT * FROM game_accounts.fetch_sealed('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', '10.0.0.1')$q$, 'no credentials are available');
SELECT pg_temp.expect_fail('a closed handover is final',
 $q$UPDATE game_accounts.handovers SET status = 'taken_over' WHERE order_id = 'd0000000-0000-4000-8000-000000000001'$q$, 'handover is closed');
SELECT pg_temp.expect_fail('FR-GAM-19 a handover cannot be closed while ciphertext remains',
 $q$UPDATE game_accounts.handovers SET status = 'closed', closed_at = now() WHERE order_id = 'd0000000-0000-4000-8000-000000000003'$q$,
 'ciphertext must be deleted');
SELECT game_accounts.finish('d0000000-0000-4000-8000-000000000002', true);
SELECT pg_temp.ok('an order refunded before the takeover cancels the handover',
  (SELECT status = 'cancelled' FROM game_accounts.handovers WHERE order_id = 'd0000000-0000-4000-8000-000000000002'));

-- ---------------------------------------------------------------- events, grants
SELECT pg_temp.expect_fail('DC-6 outbox events are named game_accounts.<entity>.<past>',
 $q$INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload) VALUES ('orders.order.paid', gen_random_uuid(), '{}')$q$, 'outbox_event_type_check');
SET LOCAL ROLE tb_app;
SELECT pg_temp.expect_fail('application role cannot rewrite takeover confirmations',
 $q$UPDATE game_accounts.confirmations SET at = now()$q$, 'permission denied');
SELECT pg_temp.expect_fail('application role cannot delete sealed credentials rows (only blank them)',
 $q$DELETE FROM game_accounts.sealed_credentials$q$, 'permission denied');
RESET ROLE;

ROLLBACK;
