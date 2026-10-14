-- Tests for the database-enforced rules of Unit 2. Run after 01_identity_access.sql
-- and 02_orders_payments.sql:   psql -v ON_ERROR_STOP=1 -f 02_orders_payments_tests.sql
-- Every check prints PASS; any failure stops the script. Runs in one transaction and rolls back.
BEGIN;
SET client_min_messages = notice;

-- expect_fail checks that the statement is rejected AND, when 'expect' is given, that the
-- error names the intended rule, so a test cannot pass because some other rule fired.
CREATE FUNCTION pg_temp.expect_fail(label text, stmt text, expect text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF expect IS NOT NULL AND position(expect IN SQLERRM) = 0 THEN
      RAISE EXCEPTION 'FAIL  % : rejected for the wrong reason: %', label, SQLERRM;
    END IF;
    RAISE NOTICE 'PASS  % [%]', label, coalesce(expect, left(SQLERRM, 60));
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
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-000000000001', 'Buyer',  '+8801711000001', now(), 'buyer@tb.test',  '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000002', 'Seller', '+8801811000002', now(), 'seller@tb.test', '$argon2id$v=19$x', true, now());

-- a valid order: 1 item at BDT 10,000 with courier delivery at BDT 150 (the SRS worked example)
INSERT INTO orders.orders (id, kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price,
   fulfilment, delivery_quote_id, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps,
   params_version, payment_due_at)
VALUES ('d0000000-0000-4000-8000-000000000001', 'fixed_price', 'e0000000-0000-4000-8000-000000000001', 'physical',
   'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 1000000, 1000000,
   'courier', 'f0000000-0000-4000-8000-000000000001', 15000, 1015000, '{"title":"Phone"}', 500, 1000, 1,
   now() + interval '15 minutes');

-- ---------------------------------------------------------------- orders
SELECT pg_temp.expect_fail('FR-FIX-01 buyer cannot buy own listing',
 $q$INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
    VALUES ('fixed_price', gen_random_uuid(), 'physical', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 1, 100, 100, 100, '{}', 500, 1000, 1, now())$q$, 'buyer_not_seller');
SELECT pg_temp.expect_fail('total must equal item price plus delivery fee',
 $q$INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
    VALUES ('fixed_price', gen_random_uuid(), 'physical', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 2, 100, 200, 150, '{}', 500, 1000, 1, now())$q$, 'total_matches');
SELECT pg_temp.expect_fail('FR-LST-05 auction order has quantity 1',
 $q$INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
    VALUES ('auction', gen_random_uuid(), 'physical', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 2, 100, 200, 200, '{}', 500, 1000, 1, now())$q$, 'auction_single_unit');
SELECT pg_temp.expect_fail('FR-DLV-02 self-pickup adds no delivery fee',
 $q$INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
    VALUES ('fixed_price', gen_random_uuid(), 'physical', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 100, 100, 'self_pickup', 50, 150, '{}', 500, 1000, 1, now())$q$, 'fee_only_for_courier');
SELECT pg_temp.expect_fail('FR-GAM-06 a game account cannot go by courier',
 $q$INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, fulfilment, delivery_quote_id, delivery_fee, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
    VALUES ('fixed_price', gen_random_uuid(), 'game_account', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 100, 100, 'courier', gen_random_uuid(), 50, 150, '{}', 500, 1000, 1, now())$q$, 'game_fulfilment_matches');
SELECT pg_temp.expect_fail('an order cannot be paid before a fulfilment method is chosen',
 $q$INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at, status, paid_at, fulfilment_step, fulfilment_due_at)
    VALUES ('fixed_price', gen_random_uuid(), 'physical', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 100, 100, 100, '{}', 500, 1000, 1, now(), 'paid', now(), 'meetup_handover', now())$q$, 'paid_needs_fulfilment');
SELECT pg_temp.expect_fail('a paid order must carry its fulfilment deadline (FR-PAY-08)',
 $q$UPDATE orders.orders SET status='paid', paid_at=now() WHERE id='d0000000-0000-4000-8000-000000000001'$q$, 'paid_needs_deadline');

-- auction: one live order per listing; a second-chance order is allowed after the first is cancelled
INSERT INTO orders.orders (id, kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
VALUES ('d0000000-0000-4000-8000-000000000002', 'auction', 'e0000000-0000-4000-8000-000000000002', 'physical',
        'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 500000, 500000, 500000, '{}', 500, 1000, 1, now() + interval '24 hours');
SELECT pg_temp.expect_fail('FR-AUC-14 one live order per auction',
 $q$INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
    VALUES ('second_chance', 'e0000000-0000-4000-8000-000000000002', 'physical', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 450000, 450000, 450000, '{}', 500, 1000, 1, now())$q$, 'orders_one_live_auction');
UPDATE orders.orders SET status='cancelled', cancelled_at=now(), cancel_reason='payment_window_expired' WHERE id='d0000000-0000-4000-8000-000000000002';
INSERT INTO orders.orders (kind, listing_id, item_kind, buyer_id, seller_id, quantity, unit_price, item_price, total, listing_snapshot, commission_bps, delivery_margin_bps, params_version, payment_due_at)
VALUES ('second_chance', 'e0000000-0000-4000-8000-000000000002', 'physical', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 1, 450000, 450000, 450000, '{}', 500, 1000, 1, now() + interval '24 hours');
SELECT pg_temp.ok('FR-AUC-15 second-chance order allowed after the winner''s order is cancelled', true);

-- ---------------------------------------------------------------- payment attempts and events
INSERT INTO payments.attempts (id, purpose, order_id, payer_id, provider, amount, expires_at)
VALUES ('a1000000-0000-4000-8000-000000000001', 'order', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'bkash', 1015000, now() + interval '15 minutes'),
       ('a1000000-0000-4000-8000-000000000002', 'order', 'd0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'stripe', 1015000, now() + interval '15 minutes');
UPDATE payments.attempts SET status='succeeded', confirmed_at=now(), provider_payment_id='BK-1', provider_txn_id='TX1'
 WHERE id='a1000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_fail('AC-4 an order can be paid only once',
 $q$UPDATE payments.attempts SET status='succeeded', confirmed_at=now() WHERE id='a1000000-0000-4000-8000-000000000002'$q$, 'attempts_one_success_per_order');
UPDATE payments.attempts SET status='succeeded_duplicate', confirmed_at=now() WHERE id='a1000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('a second successful payment is recorded as a duplicate (to be refunded)', true);
SELECT pg_temp.expect_fail('only BDT is accepted',
 $q$INSERT INTO payments.attempts (purpose, order_id, payer_id, provider, amount, currency, expires_at) VALUES ('order','d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','stripe',100,'USD',now())$q$, 'attempts_currency_check');
INSERT INTO payments.provider_events (provider, event_id, event_type, verified_by, attempt_id, payload_sha256)
VALUES ('stripe', 'evt_1', 'checkout.session.completed', 'signature', 'a1000000-0000-4000-8000-000000000002', decode(repeat('ab',32),'hex'));
SELECT pg_temp.expect_fail('SEC-PAY-04 a replayed provider event is rejected',
 $q$INSERT INTO payments.provider_events (provider, event_id, event_type, verified_by, payload_sha256) VALUES ('stripe','evt_1','checkout.session.completed','signature',decode(repeat('ab',32),'hex'))$q$, 'provider_events_provider_event_id_key');

-- ---------------------------------------------------------------- order paid, escrow held
UPDATE orders.orders SET status='paid', paid_at=now(), fulfilment_step='courier_pickup', fulfilment_due_at=now()+interval '3 days'
 WHERE id='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_fail('FR-PAY-05 escrow must start in held',
 $q$INSERT INTO orders.escrows (order_id, state, release_policy, amount_collected) VALUES ('d0000000-0000-4000-8000-000000000001','released','standard',1015000)$q$, 'must start in held');
INSERT INTO orders.escrows (order_id, release_policy, amount_collected)
VALUES ('d0000000-0000-4000-8000-000000000001', 'standard', 1015000);
SELECT pg_temp.expect_fail('FR-PAY-06 held -> partially_refunded is not a permitted transition',
 $q$UPDATE orders.escrows SET state='partially_refunded', amount_released=815000, amount_refunded=200000, terminal_at=now() WHERE order_id='d0000000-0000-4000-8000-000000000001'$q$, 'is not permitted');
SELECT pg_temp.expect_fail('FR-DSP-02 a frozen escrow names its dispute',
 $q$UPDATE orders.escrows SET state='frozen_disputed' WHERE order_id='d0000000-0000-4000-8000-000000000001'$q$, 'escrow_frozen_has_dispute');
SELECT pg_temp.expect_fail('amount collected cannot change',
 $q$UPDATE orders.escrows SET amount_collected=1 WHERE order_id='d0000000-0000-4000-8000-000000000001'$q$, 'amount_collected is fixed');
SELECT pg_temp.expect_fail('a delivery event needs the fulfilment step first',
 $q$UPDATE orders.orders SET delivery_event_at=now(), delivery_event_source='courier_delivered' WHERE id='d0000000-0000-4000-8000-000000000001'$q$, 'delivery_after_fulfilment');
UPDATE orders.orders SET fulfilment_done_at=now(), delivery_event_at=now(), delivery_event_source='courier_delivered'
 WHERE id='d0000000-0000-4000-8000-000000000001';
UPDATE orders.escrows SET dispute_window_ends_at=now()+interval '3 days', auto_release_at=now()+interval '5 days'
 WHERE order_id='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_fail('dispute window must end before auto-release',
 $q$UPDATE orders.escrows SET dispute_window_ends_at=now()+interval '6 days' WHERE order_id='d0000000-0000-4000-8000-000000000001'$q$, 'escrow_window_before_release');

-- dispute, then partial refund of BDT 2,000 (SRS Chapter 8 example)
UPDATE orders.escrows SET state='frozen_disputed', open_dispute_id='b2000000-0000-4000-8000-000000000001'
 WHERE order_id='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_fail('a partial refund must leave something released',
 $q$UPDATE orders.escrows SET state='partially_refunded', open_dispute_id=NULL, amount_refunded=1015000, terminal_at=now() WHERE order_id='d0000000-0000-4000-8000-000000000001'$q$, 'escrow_partial_both');
UPDATE orders.escrows SET state='partially_refunded', open_dispute_id=NULL, amount_released=815000, amount_refunded=200000, terminal_at=now()
 WHERE order_id='d0000000-0000-4000-8000-000000000001';
SELECT pg_temp.expect_fail('a terminal escrow cannot change again',
 $q$UPDATE orders.escrows SET state='held', amount_released=0, amount_refunded=0, terminal_at=NULL WHERE order_id='d0000000-0000-4000-8000-000000000001'$q$, 'is not permitted');
INSERT INTO orders.escrow_history (order_id, from_state, to_state, actor_type, reason, amount_released, amount_refunded)
VALUES ('d0000000-0000-4000-8000-000000000001', 'frozen_disputed', 'partially_refunded', 'staff', 'dispute decided', 815000, 200000);
SELECT pg_temp.expect_fail('FR-PAY-10 escrow history is append-only',
 $q$UPDATE orders.escrow_history SET reason='changed'$q$, 'append-only');

-- ---------------------------------------------------------------- fee split (FR-PAY-11/14, FR-MON-01, FR-DLV-13)
SELECT pg_temp.ok('SRS worked example, release: 500 + 15 + 135 + 9,500 = 10,150 BDT',
 (SELECT commission=50000 AND delivery_margin=1500 AND courier_payout=13500 AND seller_payout=950000 AND refund_total=0
    FROM payments.split(1000000, 15000, 0, true, 500, 1000)));
SELECT pg_temp.ok('SRS worked example, partial refund of BDT 2,000: commission 400, seller 7,600',
 (SELECT commission=40000 AND delivery_margin=1500 AND courier_payout=13500 AND seller_payout=760000 AND refund_total=200000
    FROM payments.split(1000000, 15000, 200000, true, 500, 1000)));
SELECT pg_temp.ok('courier never picked up: the whole delivery fee is refunded',
 (SELECT refund_total=1015000 AND courier_payout=0 AND delivery_margin=0 AND seller_payout=0 AND commission=0
    FROM payments.split(1000000, 15000, 1000000, false, 500, 1000)));
SELECT pg_temp.ok('half-up rounding to the poisha: 5% of 33 poisha is 2 (1.65 rounds up)',
 (SELECT commission=2 FROM payments.split(33, 0, 0, true, 500, 1000)));
SELECT pg_temp.ok('FR-PAY-14 property: 20,000 random cases always add up exactly and never go negative',
 (SELECT bool_and(s.commission + s.courier_payout + s.delivery_margin + s.seller_payout + s.refund_total = r.item + r.fee
                  AND least(s.commission, s.courier_payout, s.delivery_margin, s.seller_payout, s.refund_total) >= 0)
    FROM (SELECT (1 + floor(random()*50000000))::bigint AS item, floor(random()*50000)::bigint AS fee,
                 random() AS rf, random() < 0.5 AS done, floor(random()*2001)::int AS cb, floor(random()*5001)::int AS mb
            FROM generate_series(1, 20000)) r,
         LATERAL payments.split(r.item, r.fee, floor(r.rf * r.item)::bigint, r.done, r.cb, r.mb) s));
SELECT pg_temp.expect_fail('item refund larger than the item price is refused',
 $q$SELECT * FROM payments.split(1000, 100, 1001, false, 500, 1000)$q$, 'out of range');

INSERT INTO payments.settlements (order_id, amount_collected, item_price, delivery_fee, commission, courier_payout, delivery_margin, seller_payout, refund_total, commission_bps, delivery_margin_bps)
SELECT 'd0000000-0000-4000-8000-000000000001', 1015000, 1000000, 15000, s.commission, s.courier_payout, s.delivery_margin, s.seller_payout, s.refund_total, 500, 1000
  FROM payments.split(1000000, 15000, 200000, true, 500, 1000) s;
SELECT pg_temp.expect_fail('FR-PAY-13 one settlement record per order, never rewritten',
 $q$UPDATE payments.settlements SET commission = commission + 1$q$, 'append-only');
SELECT pg_temp.expect_fail('FR-PAY-14 a settlement whose parts do not add up is refused',
 $q$INSERT INTO payments.settlements (order_id, amount_collected, item_price, delivery_fee, commission, courier_payout, delivery_margin, seller_payout, refund_total, commission_bps, delivery_margin_bps) VALUES ('d0000000-0000-4000-8000-000000000002', 500000, 500000, 0, 25000, 0, 0, 475001, 0, 500, 1000)$q$, 'settlement_parts_sum');

-- ---------------------------------------------------------------- refunds
INSERT INTO payments.refunds (attempt_id, order_id, amount, reason)
VALUES ('a1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 200000, 'dispute_partial');
SELECT pg_temp.expect_fail('refunds can never exceed the payment',
 $q$INSERT INTO payments.refunds (attempt_id, order_id, amount, reason) VALUES ('a1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',815001,'fee_refund')$q$, 'exceed payment');

-- ---------------------------------------------------------------- double-entry ledger
SELECT pg_temp.expect_fail('an unbalanced journal entry is refused at commit',
 $q$WITH e AS (INSERT INTO payments.journal_entries (kind, order_id) VALUES ('payment_received','d0000000-0000-4000-8000-000000000001') RETURNING id)
    INSERT INTO payments.journal_lines (entry_id, account_code, amount) SELECT id, 'provider_clearing', 1015000 FROM e;
    SET CONSTRAINTS payments.journal_balanced IMMEDIATE$q$, 'does not balance');
SET CONSTRAINTS ALL DEFERRED;

-- payment received, then the partial-refund settlement, as balanced entries
WITH e AS (INSERT INTO payments.journal_entries (kind, order_id) VALUES ('payment_received', 'd0000000-0000-4000-8000-000000000001') RETURNING id)
INSERT INTO payments.journal_lines (entry_id, account_code, party_id, amount)
SELECT id, a, p, v FROM e, (VALUES ('provider_clearing', NULL::uuid, 1015000::bigint),
                                    ('escrow_liability', 'd0000000-0000-4000-8000-000000000001'::uuid, -1015000::bigint)) x(a, p, v);
WITH e AS (INSERT INTO payments.journal_entries (kind, order_id) VALUES ('escrow_partial', 'd0000000-0000-4000-8000-000000000001') RETURNING id)
INSERT INTO payments.journal_lines (entry_id, account_code, party_id, amount)
SELECT id, a, p, v FROM e, (VALUES ('escrow_liability', 'd0000000-0000-4000-8000-000000000001'::uuid, 1015000::bigint),
                                    ('buyer_refund_payable', 'c0000000-0000-4000-8000-000000000001'::uuid, -200000::bigint),
                                    ('revenue_commission', NULL::uuid, -40000::bigint),
                                    ('revenue_delivery_margin', NULL::uuid, -1500::bigint),
                                    ('courier_payable', NULL::uuid, -13500::bigint),
                                    ('seller_payable', 'c0000000-0000-4000-8000-000000000002'::uuid, -760000::bigint)) x(a, p, v);
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.ok('balanced entries are accepted', true);
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.ok('escrow liability of a settled order nets to zero',
 (SELECT sum(amount) = 0 FROM payments.journal_lines WHERE account_code='escrow_liability' AND party_id='d0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('FR-MON-09 revenue log shows commission 400 and margin 15 BDT',
 (SELECT sum(revenue) = 41500 FROM payments.revenue_log WHERE order_id='d0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.ok('ledger balance equals settlement record',
 (SELECT -sum(l.amount) FILTER (WHERE l.account_code='seller_payable') = s.seller_payout
     AND -sum(l.amount) FILTER (WHERE l.account_code='buyer_refund_payable') = s.refund_total
    FROM payments.journal_lines l JOIN payments.journal_entries e ON e.id=l.entry_id
    JOIN payments.settlements s ON s.order_id=e.order_id
   WHERE e.order_id='d0000000-0000-4000-8000-000000000001' GROUP BY s.seller_payout, s.refund_total));
SELECT pg_temp.expect_fail('journal lines are append-only',
 $q$UPDATE payments.journal_lines SET amount = amount + 1$q$, 'append-only');

-- ---------------------------------------------------------------- payout accounts and payouts
INSERT INTO payments.payout_accounts (id, user_id, kind, wallet_e164, status, effective_at)
VALUES ('a2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'bkash_wallet', '+8801811000002', 'cooling_off', now() + interval '24 hours');
SELECT pg_temp.expect_fail('FR-PAY-17 one current payout account per seller',
 $q$INSERT INTO payments.payout_accounts (user_id, kind, wallet_e164, status, effective_at) VALUES ('c0000000-0000-4000-8000-000000000002','nagad_wallet','+8801811000002','cooling_off',now())$q$, 'payout_account_one_current');
SELECT pg_temp.expect_fail('FR-PAY-17 a bank account becomes usable only after an operator check',
 $q$INSERT INTO payments.payout_accounts (user_id, kind, bank_name, routing_number, account_name, account_number_enc, status, effective_at) VALUES ('c0000000-0000-4000-8000-000000000001','bank','Bank','123456789','Buyer','\x01','active',now())$q$, 'bank_reviewed');
INSERT INTO payments.payouts (order_id, seller_id, payout_account_id, amount, status, simulated)
VALUES ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001', 760000, 'waiting_cooling_off', true);
SELECT pg_temp.expect_fail('one payout per order',
 $q$INSERT INTO payments.payouts (order_id, seller_id, payout_account_id, amount, status, simulated) VALUES ('d0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001',760000,'pending',true)$q$, 'payouts_order_id_key');
SELECT pg_temp.expect_fail('FR-TNS-05 a held payout records why',
 $q$UPDATE payments.payouts SET status='held' WHERE order_id='d0000000-0000-4000-8000-000000000001'$q$, 'payout_hold_reason');

-- ---------------------------------------------------------------- outbox and grants
SELECT pg_temp.expect_fail('outbox events belong to this unit',
 $q$INSERT INTO orders.outbox (event_type, aggregate_id, payload) VALUES ('identity.kyc.verified', gen_random_uuid(), '{}')$q$, 'outbox_event_type_check');
SET LOCAL ROLE tb_app;
SELECT pg_temp.expect_fail('application role cannot rewrite escrow history',
 $q$UPDATE orders.escrow_history SET reason='x'$q$, 'permission denied');
SELECT pg_temp.expect_fail('application role cannot change the ledger chart of accounts',
 $q$UPDATE payments.ledger_accounts SET kind='asset'$q$, 'permission denied');
SELECT pg_temp.expect_fail('application role cannot delete orders',
 $q$DELETE FROM orders.orders$q$, 'permission denied');
RESET ROLE;

ROLLBACK;
