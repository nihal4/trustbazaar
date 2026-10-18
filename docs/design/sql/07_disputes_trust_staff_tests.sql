-- Tests for the database-enforced rules of Unit 7 (Disputes, Trust & Safety, Staff Tools). Run
-- after the Unit 1-7 schemas:  psql -v ON_ERROR_STOP=1 -f 07_disputes_trust_staff_tests.sql
-- Each rejection must name the intended rule. One transaction, rolled back, so it can be rerun.
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
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash, created_by) VALUES
 ('b0000000-0000-4000-8000-000000000001', 'op1@tb.test', 'Operator One', 'operator', 'active', '$argon2id$v=19$x', 'a0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000002', 'op2@tb.test', 'Operator Two', 'operator', 'active', '$argon2id$v=19$x', 'a0000000-0000-4000-8000-000000000001'),
 ('a0000000-0000-4000-8000-000000000002', 'admin2@tb.test', 'Admin Two', 'administrator', 'active', '$argon2id$v=19$x', 'a0000000-0000-4000-8000-000000000001');
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-000000000001', 'Buyer',    '+8801711000001', now(), 'b@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000002', 'Seller',   '+8801811000002', now(), 's@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000003', 'Stranger', '+8801911000003', now(), 'x@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000004', 'Seller2',  '+8801611000004', now(), 's2@tb.test', '$argon2id$v=19$x', true, now());
-- paid orders 1..9 between buyer and seller (Unit 2 rules); order 9 is large (BDT 25,000)
INSERT INTO orders.orders (id, kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price,
    fulfilment, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at,
    status, paid_at, fulfilment_step, fulfilment_due_at)
SELECT ('d0000000-0000-4000-8000-00000000000' || n)::uuid, 'fixed_price', gen_random_uuid(),
       CASE WHEN n = 8 THEN 'game_account'::orders.item_kind ELSE 'physical' END,
       'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1,
       CASE WHEN n = 9 THEN 2500000 ELSE 1000000 END, CASE WHEN n = 9 THEN 2500000 ELSE 1000000 END,
       CASE WHEN n = 8 THEN 'game_account'::orders.fulfilment ELSE 'self_pickup' END, 0, CASE WHEN n = 9 THEN 2500000 ELSE 1000000 END,
       '{}', 500, 1000, 1, now(), 'paid', now(),
       CASE WHEN n = 8 THEN 'credentials_delivered'::orders.fulfilment_step ELSE 'meetup_handover' END, now() + interval '7 days'
  FROM generate_series(1, 9) n;
-- an executed four-eyes approval (Unit 1): proposed by operator one, approved by operator two
INSERT INTO identity.approvals (id, action, target_type, target_id, reason, required_role, proposed_by, expires_at,
                                decided_by, decided_at, decision, executed_at)
VALUES ('f0000000-0000-4000-8000-000000000001', 'dispute.outcome_20000', 'dispute', gen_random_uuid(), 'Refund of a BDT 25,000 order after review',
        'operator', 'b0000000-0000-4000-8000-000000000001', now() + interval '1 day',
        'b0000000-0000-4000-8000-000000000002', now(), 'approved', now()),
       ('f0000000-0000-4000-8000-000000000002', 'account.reinstate', 'user', 'c0000000-0000-4000-8000-000000000002', 'Reinstate after an appeal was upheld',
        'operator', 'b0000000-0000-4000-8000-000000000001', now() + interval '1 day',
        'b0000000-0000-4000-8000-000000000002', now(), 'approved', now()),
       ('f0000000-0000-4000-8000-000000000003', 'emergency.control', 'config', gen_random_uuid(), 'Pause new orders during a provider outage',
        'administrator', 'a0000000-0000-4000-8000-000000000001', now() + interval '1 day',
        'a0000000-0000-4000-8000-000000000002', now(), 'approved', now());
CREATE FUNCTION pg_temp.open(p_order int, p_type disputes.dispute_type, p_window interval DEFAULT '48 hours') RETURNS uuid LANGUAGE sql AS $$
  SELECT disputes.open(('d0000000-0000-4000-8000-00000000000' || p_order)::uuid, 'c0000000-0000-4000-8000-000000000001',
         'c0000000-0000-4000-8000-000000000002', CASE WHEN p_order = 8 THEN 'game_account' ELSE 'physical' END, p_type,
         'The phone does not hold a charge and the screen has a crack.', CASE WHEN p_order = 9 THEN 2500000 ELSE 1000000 END,
         CASE WHEN p_order = 9 THEN 2500000 ELSE 1000000 END, true, p_window)
$$;

-- ---------------------------------------------------------------- opening (FR-DSP-01, FR-DSP-11)
SELECT pg_temp.expect_fail('FR-DSP-01 no dispute outside its window, or when the payment is not held',
 $q$SELECT disputes.open('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'physical', 'damaged', 'The phone arrived with a broken screen.', 1000000, 1000000, false, '48 hours')$q$,
 'cannot be opened now');
SELECT pg_temp.expect_fail('FR-DSP-01 a game-account dispute type is not accepted for a physical item',
 $q$SELECT pg_temp.open(1, 'credentials_invalid')$q$, 'dispute_type_fits_item');
SELECT pg_temp.expect_fail('FR-DSP-01 a physical dispute type is not accepted for a game account',
 $q$SELECT pg_temp.open(8, 'not_received')$q$, 'dispute_type_fits_item');
SELECT pg_temp.expect_fail('a dispute needs a real description',
 $q$SELECT disputes.open('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'physical', 'damaged', 'broken', 1000000, 1000000, true, '48 hours')$q$,
 'disputes_description_check');
SELECT pg_temp.open(1, 'damaged') AS d1 \gset
SELECT pg_temp.ok('FR-DSP-01 a dispute opens as open, with the seller''s CP-20 deadline, a history row and an event',
  (SELECT status = 'open' AND seller_due_at = now() + interval '48 hours' FROM disputes.disputes WHERE id = :'d1')
  AND (SELECT count(*) = 1 FROM disputes.history WHERE dispute_id = :'d1' AND to_status = 'open' AND actor = 'buyer')
  AND EXISTS (SELECT 1 FROM disputes.outbox WHERE event_type = 'disputes.dispute.opened' AND aggregate_id = :'d1'));
SELECT pg_temp.expect_fail('FR-DSP-11 only one dispute open on an order at a time',
 $q$SELECT pg_temp.open(1, 'not_as_described')$q$, 'already open');
SELECT pg_temp.ok('FR-GAM-16 a seller_recovery dispute is accepted for a game account', pg_temp.open(8, 'seller_recovery') IS NOT NULL);
SELECT pg_temp.expect_fail('a dispute cannot jump to decided',
 $q$UPDATE disputes.disputes SET status = 'decided' WHERE id = '$q$ || :'d1' || $q$'$q$, 'is not permitted');
SELECT pg_temp.expect_fail('what a dispute is about is fixed',
 $q$UPDATE disputes.disputes SET type = 'other' WHERE id = '$q$ || :'d1' || $q$'$q$, 'is fixed');

-- ---------------------------------------------------------------- response and evidence (FR-DSP-04)
SELECT pg_temp.expect_fail('FR-DSP-04 only the seller responds',
 $q$SELECT disputes.seller_respond('$q$ || :'d1' || $q$', 'c0000000-0000-4000-8000-000000000001', 'not me', '5 days')$q$, 'only the seller');
SELECT disputes.seller_respond(:'d1', 'c0000000-0000-4000-8000-000000000002', 'The phone worked when it was handed over; the buyer inspected it.', '5 days');
SELECT pg_temp.ok('FR-DSP-04 the seller''s response starts the review, with the CP-21 decision target',
  (SELECT status = 'under_review' AND decision_target_at = now() + interval '5 days' FROM disputes.disputes WHERE id = :'d1')
  AND EXISTS (SELECT 1 FROM disputes.statements WHERE dispute_id = :'d1' AND party = 'seller'));
INSERT INTO disputes.evidence (dispute_id, party, storage_key, sha256, mime, byte_size)
SELECT :'d1', CASE WHEN i % 2 = 0 THEN 'buyer'::disputes.party ELSE 'seller' END, 'ev-' || i, sha256(int4send(i)), 'image/jpeg', 1000
  FROM generate_series(1, 10) i;
SELECT pg_temp.expect_fail('CP-33 at most 10 evidence files per dispute',
 $q$INSERT INTO disputes.evidence (dispute_id, party, storage_key, sha256, mime, byte_size) VALUES ('$q$ || :'d1' || $q$', 'buyer', 'ev-11', sha256('\x0b'), 'image/png', 1000)$q$,
 'at most 10 evidence files');
SELECT pg_temp.expect_fail('evidence cannot be altered',
 $q$UPDATE disputes.evidence SET mime = 'image/png' WHERE dispute_id = '$q$ || :'d1' || $q$'$q$, 'append-only');

-- ---------------------------------------------------------------- deciding (FR-DSP-06, CP-30)
SELECT pg_temp.expect_fail('only the assigned operator decides',
 $q$SELECT disputes.decide('$q$ || :'d1' || $q$', 'b0000000-0000-4000-8000-000000000001', 'full_refund', 'The photos show the crack existed before handover.')$q$, 'only the assigned operator');
SELECT disputes.assign(:'d1', 'b0000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_fail('a case assigned to one operator cannot be taken by another',
 $q$SELECT disputes.assign('$q$ || :'d1' || $q$', 'b0000000-0000-4000-8000-000000000002')$q$, 'assigned to another operator');
SELECT pg_temp.expect_fail('FR-DSP-06 every decision has a reason',
 $q$SELECT disputes.decide('$q$ || :'d1' || $q$', 'b0000000-0000-4000-8000-000000000001', 'release', 'ok')$q$, 'dispute_decision_fields');
SELECT pg_temp.expect_fail('FR-PAY-11 a partial refund is above zero and below the item price',
 $q$SELECT disputes.decide('$q$ || :'d1' || $q$', 'b0000000-0000-4000-8000-000000000001', 'partial_refund', 'Minor damage, part refund agreed on evidence.', 1000000)$q$, 'dispute_partial_amount');
SELECT pg_temp.expect_fail('FR-DSP-06(d) refund after return needs the fare and who pays it',
 $q$SELECT disputes.decide('$q$ || :'d1' || $q$', 'b0000000-0000-4000-8000-000000000001', 'refund_after_return', 'Item not as described; return it for a refund.')$q$, 'dispute_return_fields');
SELECT pg_temp.ok('FR-DSP-06 a partial refund is decided',
  disputes.decide(:'d1', 'b0000000-0000-4000-8000-000000000001', 'partial_refund', 'Minor damage shown in the photos; part refund.', 200000) = 'decided');
SELECT pg_temp.ok('FR-DSP-09 the history shows open, under review and decided, each with its actor',
  (SELECT array_agg(to_status::text || ':' || actor::text ORDER BY id) FROM disputes.history WHERE dispute_id = :'d1')
  = ARRAY['open:buyer', 'under_review:seller', 'decided:operator']);
SELECT pg_temp.ok('FR-TNS-04 losing a dispute is a seller strike',
  EXISTS (SELECT 1 FROM trust.strikes WHERE order_id = 'd0000000-0000-4000-8000-000000000001' AND reason = 'dispute_lost'));
SELECT pg_temp.expect_fail('a decided dispute is closed',
 $q$UPDATE disputes.disputes SET outcome = 'release' WHERE id = '$q$ || :'d1' || $q$'$q$, 'dispute is closed');
SELECT pg_temp.expect_fail('the dispute history is append-only',
 $q$DELETE FROM disputes.history$q$, 'append-only');

SELECT pg_temp.open(9, 'not_as_described') AS d9 \gset
SELECT disputes.seller_respond(:'d9', 'c0000000-0000-4000-8000-000000000002', 'The description matched the item exactly.', '5 days');
SELECT disputes.assign(:'d9', 'b0000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_fail('CP-30 a decision on BDT 20,000 or more needs four-eyes approval',
 $q$SELECT disputes.decide('$q$ || :'d9' || $q$', 'b0000000-0000-4000-8000-000000000001', 'full_refund', 'The item differs materially from the listing.')$q$, 'four-eyes approval');
SELECT pg_temp.ok('CP-30 with an executed approval the large decision goes through',
  disputes.decide(:'d9', 'b0000000-0000-4000-8000-000000000001', 'full_refund', 'The item differs materially from the listing.',
                  NULL, NULL, NULL, 'f0000000-0000-4000-8000-000000000001') = 'decided');

-- refund after return (FR-DSP-06(d))
SELECT pg_temp.open(2, 'not_as_described') AS d2 \gset
SELECT disputes.seller_respond(:'d2', 'c0000000-0000-4000-8000-000000000002', 'I am happy to take it back.', '5 days');
SELECT disputes.assign(:'d2', 'b0000000-0000-4000-8000-000000000002');
SELECT pg_temp.ok('FR-DSP-06(d) refund after return waits for the item',
  disputes.decide(:'d2', 'b0000000-0000-4000-8000-000000000002', 'refund_after_return', 'Wrong model sent; buyer returns it, seller pays the fare.',
                  NULL, 5000, 'seller') = 'awaiting_return');
SELECT pg_temp.expect_fail('no new evidence once the decision is made',
 $q$INSERT INTO disputes.evidence (dispute_id, party, storage_key, sha256, mime, byte_size) VALUES ('$q$ || :'d2' || $q$', 'buyer', 'ev-late', sha256('\x0c'), 'image/png', 1000)$q$,
 'only while the dispute is being considered');
SELECT disputes.return_completed(:'d2');
SELECT pg_temp.ok('... and is decided when the item is back',
  (SELECT status = 'decided' AND closed_at IS NOT NULL FROM disputes.disputes WHERE id = :'d2'));

-- withdrawal (FR-DSP-10)
SELECT pg_temp.open(3, 'damaged') AS d3 \gset
SELECT pg_temp.expect_fail('only the buyer withdraws',
 $q$SELECT disputes.withdraw('$q$ || :'d3' || $q$', 'c0000000-0000-4000-8000-000000000002')$q$, 'only the buyer');
SELECT disputes.withdraw(:'d3', 'c0000000-0000-4000-8000-000000000001');
SELECT pg_temp.ok('FR-DSP-10 the buyer withdraws before a decision; an event tells Unit 2',
  (SELECT status = 'withdrawn' FROM disputes.disputes WHERE id = :'d3')
  AND EXISTS (SELECT 1 FROM disputes.outbox WHERE event_type = 'disputes.dispute.withdrawn' AND aggregate_id = :'d3'));
SELECT pg_temp.expect_fail('FR-DSP-10 a withdrawn dispute cannot be reopened with the same type',
 $q$SELECT pg_temp.open(3, 'damaged')$q$, 'cannot be reopened');
SELECT pg_temp.ok('... but another type can be opened', pg_temp.open(3, 'not_as_described') IS NOT NULL);
SELECT pg_temp.expect_fail('a decided dispute cannot be withdrawn',
 $q$SELECT disputes.withdraw('$q$ || :'d1' || $q$', 'c0000000-0000-4000-8000-000000000001')$q$, 'cannot be withdrawn');

-- seller silent; operator asks for information (FR-DSP-04, FR-DSP-09)
SELECT pg_temp.open(4, 'damaged', interval '-1 minute') AS d4 \gset
SELECT pg_temp.expect_fail('FR-DSP-04 after CP-20 the seller can no longer respond',
 $q$SELECT disputes.seller_respond('$q$ || :'d4' || $q$', 'c0000000-0000-4000-8000-000000000002', 'late reply', '5 days')$q$, 'response window has ended');
SELECT disputes.seller_window_ended(:'d4', '5 days') AS ended \gset
SELECT pg_temp.ok('FR-DSP-04 when CP-20 passes, the review starts on the evidence available',
  :'ended'::boolean
  AND (SELECT status = 'under_review' AND last_actor = 'system' FROM disputes.disputes WHERE id = :'d4'));
SELECT disputes.assign(:'d4', 'b0000000-0000-4000-8000-000000000002');
SELECT disputes.request_info(:'d4', 'b0000000-0000-4000-8000-000000000002', '24 hours', 'Please send a photo of the packaging.');
SELECT pg_temp.ok('the operator can ask the seller for more information (awaiting_seller)',
  (SELECT status = 'awaiting_seller' AND info_due_at = now() + interval '24 hours' FROM disputes.disputes WHERE id = :'d4'));
SELECT disputes.seller_respond(:'d4', 'c0000000-0000-4000-8000-000000000002', 'Photo of the packaging attached.', '5 days');
SELECT pg_temp.ok('... and the answer returns it to review',
  (SELECT status = 'under_review' FROM disputes.disputes WHERE id = :'d4'));

-- ---------------------------------------------------------------- strikes (FR-TNS-04, CP-47)
-- (a second seller, so that the dispute strikes above do not count)
SELECT trust.record_strike('c0000000-0000-4000-8000-000000000004', 'dispute_lost', 'd0000000-0000-4000-8000-000000000004', '90 days', 3);
SELECT trust.record_strike('c0000000-0000-4000-8000-000000000004', 'missed_deadline', 'd0000000-0000-4000-8000-000000000005', '90 days', 3) AS s2 \gset
SELECT pg_temp.ok('two strikes within 90 days do not yet suspend', NOT :'s2'::boolean);
SELECT pg_temp.ok('the same strike for the same order counts once',
  NOT trust.record_strike('c0000000-0000-4000-8000-000000000004', 'missed_deadline', 'd0000000-0000-4000-8000-000000000005', '90 days', 3)
  AND (SELECT count(*) = 2 FROM trust.strikes WHERE user_id = 'c0000000-0000-4000-8000-000000000004'));
SELECT trust.record_strike('c0000000-0000-4000-8000-000000000004', 'unilateral_cancel', 'd0000000-0000-4000-8000-000000000006', '90 days', 3) AS s3 \gset
SELECT pg_temp.ok('FR-TNS-04 the CP-47 third strike suspends selling automatically, until review',
  :'s3'::boolean
  AND (SELECT kind = 'selling_suspended' AND automatic AND ends_at IS NULL FROM trust.sanctions WHERE user_id = 'c0000000-0000-4000-8000-000000000004'));
SELECT pg_temp.ok('a fourth strike does not add a second suspension',
  NOT trust.record_strike('c0000000-0000-4000-8000-000000000004', 'missed_deadline', 'd0000000-0000-4000-8000-000000000007', '90 days', 3)
  AND (SELECT count(*) = 1 FROM trust.sanctions WHERE user_id = 'c0000000-0000-4000-8000-000000000004'));
SELECT pg_temp.ok('FR-TNS-05 a selling suspension stops selling but not buying',
  (SELECT NOT can_sell AND can_buy_bid AND NOT fraud_hold FROM trust.restrictions('c0000000-0000-4000-8000-000000000004')));
SELECT pg_temp.expect_fail('strikes are append-only',
 $q$DELETE FROM trust.strikes$q$, 'append-only');

-- ---------------------------------------------------------------- sanctions (FR-TNS-03, FR-TNS-05)
SELECT pg_temp.expect_fail('FR-TNS-03 every sanction has a reason',
 $q$INSERT INTO trust.sanctions (user_id, kind, reason, created_by) VALUES ('c0000000-0000-4000-8000-000000000003', 'warning', 'bad', 'b0000000-0000-4000-8000-000000000001')$q$, 'sanctions_reason_check');
SELECT pg_temp.expect_fail('a warning has no duration',
 $q$INSERT INTO trust.sanctions (user_id, kind, reason, created_by, ends_at) VALUES ('c0000000-0000-4000-8000-000000000003', 'warning', 'Abusive language in chat', 'b0000000-0000-4000-8000-000000000001', now() + interval '1 day')$q$, 'sanction_warning_instant');
SELECT pg_temp.expect_fail('a listing removal names the listing',
 $q$INSERT INTO trust.sanctions (user_id, kind, reason, created_by) VALUES ('c0000000-0000-4000-8000-000000000003', 'listing_removal', 'Counterfeit item listed', 'b0000000-0000-4000-8000-000000000001')$q$, 'sanction_listing');
SELECT pg_temp.expect_fail('a sanction by an operator names the operator',
 $q$INSERT INTO trust.sanctions (user_id, kind, reason) VALUES ('c0000000-0000-4000-8000-000000000003', 'warning', 'Abusive language in chat')$q$, 'sanction_actor');
INSERT INTO trust.sanctions (id, user_id, kind, reason, fraud, created_by) VALUES
 ('a7000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'account_suspended', 'Advance-payment fraud confirmed in two reports', true, 'b0000000-0000-4000-8000-000000000001');
INSERT INTO trust.sanctions (user_id, kind, reason, created_by, starts_at, ends_at) VALUES
 ('c0000000-0000-4000-8000-000000000001', 'buying_suspended', 'Repeated unpaid wins in the past', 'b0000000-0000-4000-8000-000000000001', now() - interval '40 days', now() - interval '10 days');
SELECT pg_temp.ok('FR-TNS-05 an account suspension for fraud stops everything and holds payouts',
  (SELECT NOT can_sell AND NOT can_buy_bid AND fraud_hold FROM trust.restrictions('c0000000-0000-4000-8000-000000000003')));
SELECT pg_temp.ok('an expired sanction has no effect',
  (SELECT can_sell AND can_buy_bid FROM trust.restrictions('c0000000-0000-4000-8000-000000000001')));
SELECT pg_temp.expect_fail('a sanction cannot be rewritten',
 $q$UPDATE trust.sanctions SET kind = 'warning' WHERE id = 'a7000000-0000-4000-8000-000000000001'$q$, 'cannot be rewritten');
SELECT pg_temp.expect_fail('CP-30 lifting an account suspension needs four-eyes approval',
 $q$UPDATE trust.sanctions SET lifted_at = now(), lifted_by = 'b0000000-0000-4000-8000-000000000002', lift_reason = 'Appeal upheld after review' WHERE id = 'a7000000-0000-4000-8000-000000000001'$q$,
 'sanction_account_lift_approved');
UPDATE trust.sanctions SET lifted_at = now(), lifted_by = 'b0000000-0000-4000-8000-000000000002', lift_reason = 'Appeal upheld after review',
       lift_approval_id = 'f0000000-0000-4000-8000-000000000002' WHERE id = 'a7000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('with approval the suspension is lifted',
  (SELECT can_sell AND can_buy_bid AND NOT fraud_hold FROM trust.restrictions('c0000000-0000-4000-8000-000000000003')));
SELECT pg_temp.expect_fail('a lifted sanction is final',
 $q$UPDATE trust.sanctions SET lift_reason = 'changed my mind about it' WHERE id = 'a7000000-0000-4000-8000-000000000001'$q$, 'already lifted');
SELECT pg_temp.expect_fail('sanctions are never deleted',
 $q$DELETE FROM trust.sanctions$q$, 'append-only');

-- ---------------------------------------------------------------- reports and signals (FR-TNS-01, FR-OPS-01)
SELECT pg_temp.expect_fail('a user cannot report themselves',
 $q$INSERT INTO trust.reports (reporter_id, target_type, target_id, subject_user, category) VALUES ('c0000000-0000-4000-8000-000000000001', 'user', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'abusive')$q$, 'report_not_self');
SELECT pg_temp.expect_fail('a reported message names the message',
 $q$INSERT INTO trust.reports (reporter_id, target_type, target_id, subject_user, category) VALUES ('c0000000-0000-4000-8000-000000000001', 'message', gen_random_uuid(), 'c0000000-0000-4000-8000-000000000002', 'fraudulent')$q$, 'report_message_fields');
INSERT INTO trust.reports (id, reporter_id, target_type, target_id, subject_user, category, text) VALUES
 ('a7100000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'listing', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'counterfeit', 'The logo is wrong.');
SELECT pg_temp.expect_fail('one open report per reporter and target',
 $q$INSERT INTO trust.reports (reporter_id, target_type, target_id, subject_user, category) VALUES ('c0000000-0000-4000-8000-000000000001', 'listing', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'fraudulent')$q$, 'reports_one_open');
SELECT pg_temp.expect_fail('a resolved report records who resolved it and why',
 $q$UPDATE trust.reports SET status = 'dismissed' WHERE id = 'a7100000-0000-4000-8000-000000000001'$q$, 'report_resolved_fields');
INSERT INTO trust.signals (kind, source_ref, subject_user) VALUES ('shill_bidding', 'auctions.flags:42', 'c0000000-0000-4000-8000-000000000002');
SELECT pg_temp.expect_fail('a signal delivered twice is stored once',
 $q$INSERT INTO trust.signals (kind, source_ref) VALUES ('shill_bidding', 'auctions.flags:42')$q$, 'signal_once');

-- ---------------------------------------------------------------- ratings (FR-REV)
SELECT pg_temp.expect_fail('FR-REV-02 no rating for an order that never finished',
 $q$INSERT INTO trust.ratings (order_id, rater_id, ratee_id, stars, edit_until) VALUES ('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 5, now() + interval '48 hours')$q$, 'ratings_order_id_fkey');
INSERT INTO trust.rating_eligibility (order_id, buyer_id, seller_id, closed_at, rate_until, completed) VALUES
 ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', now(), now() + interval '14 days', false),
 ('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', now(), now() + interval '14 days', true),
 ('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', now() - interval '20 days', now() - interval '6 days', true);
SELECT pg_temp.expect_fail('only the two parties of the order rate each other',
 $q$INSERT INTO trust.ratings (order_id, rater_id, ratee_id, stars, edit_until) VALUES ('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002', 1, now() + interval '48 hours')$q$, 'only the buyer and the seller');
INSERT INTO trust.ratings (id, order_id, rater_id, ratee_id, stars, text, edit_until) VALUES
 ('a7200000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 4, 'Good phone, quick meetup.', now() + interval '48 hours'),
 ('a7200000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 5, NULL, now() - interval '1 minute'),
 ('a7200000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 'Rude and the item was damaged', now() + interval '48 hours');
SELECT pg_temp.ok('FR-REV-01 buyer and seller each rate the other', (SELECT count(*) = 2 FROM trust.ratings WHERE order_id = 'd0000000-0000-4000-8000-000000000005'));
SELECT pg_temp.expect_fail('FR-REV-02 at most one rating in each direction per order',
 $q$INSERT INTO trust.ratings (order_id, rater_id, ratee_id, stars, edit_until) VALUES ('d0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 2, now() + interval '48 hours')$q$, 'rating_once');
SELECT pg_temp.expect_fail('FR-REV-01 no rating after the CP-39 window',
 $q$INSERT INTO trust.ratings (order_id, rater_id, ratee_id, stars, edit_until) VALUES ('d0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 2, now() + interval '48 hours')$q$, 'rating window has ended');
UPDATE trust.ratings SET stars = 5 WHERE id = 'a7200000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('FR-REV-03 a rating may be edited within its edit period',
  (SELECT stars = 5 AND edited_at IS NOT NULL FROM trust.ratings WHERE id = 'a7200000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('FR-REV-03 and fixed afterwards',
 $q$UPDATE trust.ratings SET stars = 1 WHERE id = 'a7200000-0000-4000-8000-000000000002'$q$, 'fixed after its edit period');
SELECT pg_temp.expect_fail('FR-REV-06 a reply needs a written review to reply to',
 $q$UPDATE trust.ratings SET reply_text = 'Thanks', reply_at = now() WHERE id = 'a7200000-0000-4000-8000-000000000002'$q$, 'rating_reply_fields');
UPDATE trust.ratings SET reply_text = 'Thank you, enjoy the phone.', reply_at = now() WHERE id = 'a7200000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_fail('FR-REV-06 one reply, not changed later',
 $q$UPDATE trust.ratings SET reply_text = 'Changed reply' WHERE id = 'a7200000-0000-4000-8000-000000000001'$q$, 'only one reply');
SELECT pg_temp.expect_fail('FR-REV-07 a removal records the operator and a reason',
 $q$UPDATE trust.ratings SET removed_at = now(), removed_by = 'b0000000-0000-4000-8000-000000000001' WHERE id = 'a7200000-0000-4000-8000-000000000003'$q$, 'rating_removal_fields');
UPDATE trust.ratings SET removed_at = now(), removed_by = 'b0000000-0000-4000-8000-000000000001', removal_reason = 'Contains abuse, against the content policy'
 WHERE id = 'a7200000-0000-4000-8000-000000000003';
SELECT pg_temp.ok('FR-REV-04, FR-REV-07 removed ratings leave the average; completed orders counted',
  (SELECT average_rating = 5.0 AND rating_count = 1 AND completed_transactions = 2 FROM trust.profile_summary WHERE user_id = 'c0000000-0000-4000-8000-000000000002'));

-- ---------------------------------------------------------------- parameters (FR-OPS-08, FR-OPS-09)
SELECT pg_temp.ok('the seeded SRS defaults satisfy every rule', cardinality(staff.config_violations(staff.config_as_json(1), NULL)) = 0);
SELECT staff.publish_config('{"CP-13":"20 minutes"}', 'a0000000-0000-4000-8000-000000000001', 'Longer checkout hold after user feedback') AS v2 \gset
SELECT pg_temp.ok('FR-OPS-08 a change is a new version; the old one is kept unchanged',
  :v2 = 2 AND staff.current_config_version() = 2
  AND staff.config_as_json(1) ->> 'CP-13' = '15 minutes' AND staff.config_as_json(2) ->> 'CP-13' = '20 minutes'
  AND (SELECT count(*) FROM staff.config_values WHERE version = 2) = 49);
SELECT pg_temp.expect_fail('FR-OPS-09 CP-19 not longer than CP-18 is refused',
 $q$SELECT staff.publish_config('{"CP-19":"2 days"}', 'a0000000-0000-4000-8000-000000000001', 'Shorter release for faster payouts')$q$, 'must be longer than the CP-18');
SELECT pg_temp.expect_fail('FR-OPS-09 CP-45 outside 3 to 10 is refused',
 $q$SELECT staff.publish_config('{"CP-45":11}', 'a0000000-0000-4000-8000-000000000001', 'More attempts at the handover code')$q$, 'CP-45 must be 3-10');
SELECT pg_temp.expect_fail('FR-OPS-09 the four-eyes list may only grow',
 $q$SELECT staff.publish_config('{"CP-30":["kyc.revoke"]}', 'a0000000-0000-4000-8000-000000000001', 'Fewer approvals needed', 'f0000000-0000-4000-8000-000000000003')$q$, 'may only grow');
SELECT pg_temp.expect_fail('FR-OPS-09 all broken rules are reported',
 $q$SELECT staff.publish_config('{"CP-24":"1 day","CP-29":"1 hour"}', 'a0000000-0000-4000-8000-000000000001', 'Faster release for game accounts')$q$, 'at least 3 days; CP-29');
SELECT pg_temp.expect_fail('SEC-IRM-04 an emergency switch changes only with four-eyes approval',
 $q$SELECT staff.publish_config('{"SW-new_orders":false}', 'a0000000-0000-4000-8000-000000000001', 'Pause orders during the outage')$q$, 'four-eyes approval');
SELECT pg_temp.expect_fail('FR-GAM-01 turning the game-account feature off also needs it',
 $q$SELECT staff.publish_config('{"CP-36":false}', 'a0000000-0000-4000-8000-000000000001', 'Publisher complaint received')$q$, 'four-eyes approval');
SELECT pg_temp.ok('SEC-IRM-04 with approval the switch changes',
  staff.publish_config('{"SW-new_orders":false}', 'a0000000-0000-4000-8000-000000000001', 'Pause orders during the outage', 'f0000000-0000-4000-8000-000000000003') = 3);
SELECT pg_temp.expect_fail('an unknown parameter is refused',
 $q$SELECT staff.publish_config('{"CP-99":1}', 'a0000000-0000-4000-8000-000000000001', 'Adding a new parameter here')$q$, 'unknown parameter');
SELECT pg_temp.expect_fail('parameter versions are append-only',
 $q$UPDATE staff.config_values SET value = '"1 minute"' WHERE version = 1 AND code = 'CP-13'$q$, 'append-only');

-- ---------------------------------------------------------------- privacy (FR-PRV-03, FR-PRV-06)
INSERT INTO staff.disclosures (id, subject_user, authority, legal_reference, scope, requested_by) VALUES
 ('a7300000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'Police, Cyber Crime Unit', 'GD 1234/2026', 'Orders and chat with the complainant', 'b0000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_fail('FR-PRV-06 nothing is disclosed without four-eyes approval',
 $q$UPDATE staff.disclosures SET disclosed_at = now() WHERE id = 'a7300000-0000-4000-8000-000000000001'$q$, 'disclosure_needs_approval');
SELECT pg_temp.expect_fail('FR-PRV-06 the user is told, or the reason not to is recorded',
 $q$UPDATE staff.disclosures SET user_notified_at = now(), withheld_reason = 'Court order forbids notice' WHERE id = 'a7300000-0000-4000-8000-000000000001'$q$, 'disclosure_notice');
INSERT INTO staff.export_requests (user_id) VALUES ('c0000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_fail('FR-PRV-03 one data export in preparation per user',
 $q$INSERT INTO staff.export_requests (user_id) VALUES ('c0000000-0000-4000-8000-000000000001')$q$, 'export_one_pending');

-- ---------------------------------------------------------------- grants
SET LOCAL ROLE tb_app;
SELECT pg_temp.expect_fail('application role cannot rewrite dispute history',
 $q$UPDATE disputes.history SET reason = 'x'$q$, 'permission denied');
SELECT pg_temp.expect_fail('application role cannot delete sanctions',
 $q$DELETE FROM trust.sanctions$q$, 'permission denied');
SELECT pg_temp.expect_fail('application role cannot rewrite parameter versions',
 $q$UPDATE staff.config_values SET value = '1'$q$, 'permission denied');
RESET ROLE;

ROLLBACK;
