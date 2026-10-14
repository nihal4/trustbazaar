-- Tests for the database-enforced rules of Unit 1. Run after 01_identity_access.sql:
--   psql -v ON_ERROR_STOP=1 -f 01_identity_access_tests.sql
-- Every check prints PASS; any failure stops the script with an error.
-- The script runs in one transaction and rolls back, leaving no data behind.
BEGIN;
SET client_min_messages = notice;

CREATE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'PASS  % (rejected: %)', label, left(SQLERRM, 70);
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
 ('a0000000-0000-4000-8000-000000000001', 'admin@tb.test', 'Bootstrap Admin', 'administrator', 'active', '$argon2id$v=19$x');
INSERT INTO identity.staff_accounts (id, email, display_name, role, status, password_hash, created_by) VALUES
 ('b0000000-0000-4000-8000-000000000001', 'op1@tb.test', 'Operator One', 'operator', 'active', '$argon2id$v=19$x', 'a0000000-0000-4000-8000-000000000001'),
 ('b0000000-0000-4000-8000-000000000002', 'op2@tb.test', 'Operator Two', 'operator', 'active', '$argon2id$v=19$x', 'a0000000-0000-4000-8000-000000000001');

INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-000000000001', 'Rahim', '+8801711000001', now(), 'rahim@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000002', 'Karim', '+8801811000002', now(), 'karim@tb.test', '$argon2id$v=19$x', true, now());

-- ---------------------------------------------------------------- staff
SELECT pg_temp.expect_fail('only one bootstrap administrator',
 $q$INSERT INTO identity.staff_accounts (email, display_name, role, password_hash) VALUES ('x@tb.test','X','administrator','$argon2id$v=19$x')$q$);
SELECT pg_temp.expect_fail('staff password must be Argon2id',
 $q$INSERT INTO identity.staff_accounts (email, display_name, role, password_hash, created_by) VALUES ('y@tb.test','Y','operator','$2b$12$bcrypt','a0000000-0000-4000-8000-000000000001')$q$);

-- ---------------------------------------------------------------- users
SELECT pg_temp.expect_fail('FR-ACC-03 duplicate live mobile number',
 $q$INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES ('Dup','+8801711000001',now(),'other@tb.test','$argon2id$v=19$x',true,now())$q$);
SELECT pg_temp.expect_fail('FR-ACC-03 duplicate live e-mail, case-insensitive',
 $q$INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES ('Dup','+8801911000009',now(),'RAHIM@tb.test','$argon2id$v=19$x',true,now())$q$);
SELECT pg_temp.expect_fail('Bangladeshi mobile format enforced',
 $q$INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES ('Bad','+447700900000',now(),'uk@tb.test','$argon2id$v=19$x',true,now())$q$);
SELECT pg_temp.expect_fail('SEC-AUTH-01 short password allowed only with MFA',
 $q$INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES ('Short','+8801911000003',now(),'short@tb.test','$argon2id$v=19$x',false,now())$q$);
SELECT pg_temp.expect_fail('SEC-AUTH-01 cannot switch MFA off while password is short',
 $q$UPDATE identity.users SET mfa_enabled = true, password_single_factor_ok = false WHERE id='c0000000-0000-4000-8000-000000000002';
    UPDATE identity.users SET mfa_enabled = false WHERE id='c0000000-0000-4000-8000-000000000002'$q$);
SELECT pg_temp.expect_fail('personal fields removable only after erasure',
 $q$UPDATE identity.users SET phone_e164 = NULL WHERE id='c0000000-0000-4000-8000-000000000001'$q$);

-- a closed and erased account releases its number for a new registration
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-000000000003', 'Old', '+8801611000003', now(), 'old@tb.test', '$argon2id$v=19$x', true, now());
UPDATE identity.users SET account_status='closed', closed_at=now(), erased_at=now(),
       phone_e164=NULL, email=NULL, password_hash=NULL, display_name='Deleted user'
 WHERE id='c0000000-0000-4000-8000-000000000003';
INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at)
VALUES ('New owner', '+8801611000003', now(), 'old@tb.test', '$argon2id$v=19$x', true, now());
SELECT pg_temp.ok('erased account frees its number and e-mail', true);

-- ---------------------------------------------------------------- KYC status machine
SELECT pg_temp.expect_fail('FR-KYC-05 unsubmitted -> verified not permitted',
 $q$UPDATE identity.users SET kyc_status='verified' WHERE id='c0000000-0000-4000-8000-000000000001'$q$);
UPDATE identity.users SET kyc_status='pending_review' WHERE id='c0000000-0000-4000-8000-000000000001';
UPDATE identity.users SET kyc_status='verified'       WHERE id='c0000000-0000-4000-8000-000000000001';
SELECT pg_temp.ok('unsubmitted -> pending_review -> verified permitted',
 (SELECT kyc_status='verified' FROM identity.users WHERE id='c0000000-0000-4000-8000-000000000001'));
SELECT pg_temp.expect_fail('FR-KYC-05 verified -> pending_review not permitted',
 $q$UPDATE identity.users SET kyc_status='pending_review' WHERE id='c0000000-0000-4000-8000-000000000001'$q$);

-- ---------------------------------------------------------------- KYC submissions and identity claims
INSERT INTO identity.kyc_submissions (id, user_id, doc_type, doc_number_enc, doc_number_bidx, full_name_enc, dob_enc, key_version, is_adult, liveness_action)
VALUES ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'nid', '\x01', decode(repeat('aa',32),'hex'), '\x01', '\x01', 1, true, 'turn_left');
SELECT pg_temp.expect_fail('one open KYC submission per user',
 $q$INSERT INTO identity.kyc_submissions (user_id, doc_type, doc_number_enc, doc_number_bidx, full_name_enc, dob_enc, key_version, is_adult, liveness_action) VALUES ('c0000000-0000-4000-8000-000000000001','nid','\x01',decode(repeat('aa',32),'hex'),'\x01','\x01',1,true,'blink')$q$);
SELECT pg_temp.expect_fail('FR-KYC-06 rejection needs a reason code',
 $q$UPDATE identity.kyc_submissions SET status='rejected', decided_by='b0000000-0000-4000-8000-000000000001', decided_at=now() WHERE id='d0000000-0000-4000-8000-000000000001'$q$);
SELECT pg_temp.expect_fail('FR-KYC-03 underage submission cannot be approved',
 $q$UPDATE identity.kyc_submissions SET is_adult=false, status='approved', decided_by='b0000000-0000-4000-8000-000000000001', decided_at=now() WHERE id='d0000000-0000-4000-8000-000000000001'$q$);
UPDATE identity.kyc_submissions SET status='approved', decided_by='b0000000-0000-4000-8000-000000000001', decided_at=now()
 WHERE id='d0000000-0000-4000-8000-000000000001';
INSERT INTO identity.identity_claims (doc_number_bidx, user_id, submission_id)
VALUES (decode(repeat('aa',32),'hex'), 'c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');

INSERT INTO identity.kyc_submissions (id, user_id, doc_type, doc_number_enc, doc_number_bidx, full_name_enc, dob_enc, key_version, is_adult, liveness_action, routed_flags)
VALUES ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'nid', '\x01', decode(repeat('aa',32),'hex'), '\x01', '\x01', 1, true, 'blink', '{duplicate}');
SELECT pg_temp.expect_fail('FR-KYC-04 same NID cannot verify a second account',
 $q$INSERT INTO identity.identity_claims (doc_number_bidx, user_id, submission_id) VALUES (decode(repeat('aa',32),'hex'),'c0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002')$q$);
SELECT pg_temp.expect_fail('routed flags restricted to known values',
 $q$UPDATE identity.kyc_submissions SET routed_flags='{vip}' WHERE id='d0000000-0000-4000-8000-000000000002'$q$);

INSERT INTO identity.kyc_files (submission_id, kind, storage_key, wrapped_dek, key_version, sha256, mime, byte_size)
VALUES ('d0000000-0000-4000-8000-000000000002', 'doc_front', 'k-001', '\x01', 1, decode(repeat('bb',32),'hex'), 'image/jpeg', 1000);
SELECT pg_temp.expect_fail('SEC-INP-04 only JPEG/PNG/WebP accepted',
 $q$INSERT INTO identity.kyc_files (submission_id, kind, storage_key, wrapped_dek, key_version, sha256, mime, byte_size) VALUES ('d0000000-0000-4000-8000-000000000002','doc_back','k-002','\x01',1,decode(repeat('bb',32),'hex'),'image/svg+xml',1000)$q$);
SELECT pg_temp.expect_fail('CP-33 10 MB upload limit',
 $q$INSERT INTO identity.kyc_files (submission_id, kind, storage_key, wrapped_dek, key_version, sha256, mime, byte_size) VALUES ('d0000000-0000-4000-8000-000000000002','doc_back','k-003','\x01',1,decode(repeat('bb',32),'hex'),'image/png',20000000)$q$);
SELECT pg_temp.expect_fail('erased file must have its key destroyed',
 $q$UPDATE identity.kyc_files SET erased_at=now() WHERE storage_key='k-001'$q$);

INSERT INTO identity.kyc_status_history (user_id, from_status, to_status, actor_type, actor_id, reason)
VALUES ('c0000000-0000-4000-8000-000000000001', 'pending_review', 'verified', 'staff', 'b0000000-0000-4000-8000-000000000001', 'approved');
SELECT pg_temp.expect_fail('KYC history is append-only',
 $q$UPDATE identity.kyc_status_history SET reason='edited'$q$);
SELECT pg_temp.expect_fail('KYC history rows cannot be deleted',
 $q$DELETE FROM identity.kyc_status_history$q$);

-- ---------------------------------------------------------------- approvals and blacklist
INSERT INTO identity.approvals (id, action, target_type, target_id, reason, required_role, proposed_by, expires_at)
VALUES ('e0000000-0000-4000-8000-000000000001', 'blacklist.add', 'identity', 'c0000000-0000-4000-8000-000000000002',
        'Seller recovered a sold account (order 123)', 'operator', 'b0000000-0000-4000-8000-000000000001', now() + interval '3 days');
SELECT pg_temp.expect_fail('FR-OPS-05 proposer cannot approve own action',
 $q$UPDATE identity.approvals SET decided_by='b0000000-0000-4000-8000-000000000001', decided_at=now(), decision='approved' WHERE id='e0000000-0000-4000-8000-000000000001'$q$);
SELECT pg_temp.expect_fail('one open proposal per action and target',
 $q$INSERT INTO identity.approvals (action, target_type, target_id, reason, required_role, proposed_by, expires_at) VALUES ('blacklist.add','identity','c0000000-0000-4000-8000-000000000002','Duplicate proposal text','operator','b0000000-0000-4000-8000-000000000002',now()+interval '1 day')$q$);
SELECT pg_temp.expect_fail('decider recorded without a decision',
 $q$UPDATE identity.approvals SET decided_by='b0000000-0000-4000-8000-000000000002' WHERE id='e0000000-0000-4000-8000-000000000001'$q$);
SELECT pg_temp.expect_fail('cannot execute before approval',
 $q$UPDATE identity.approvals SET executed_at=now() WHERE id='e0000000-0000-4000-8000-000000000001'$q$);
UPDATE identity.approvals SET decided_by='b0000000-0000-4000-8000-000000000002', decided_at=now(), decision='approved', executed_at=now()
 WHERE id='e0000000-0000-4000-8000-000000000001';
INSERT INTO identity.nid_blacklist (doc_number_bidx, source, reason, added_by, add_approval_id)
VALUES (decode(repeat('cc',32),'hex'), 'game_account_recovery', 'Recovered sold account', 'b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_fail('one active blacklist entry per identity',
 $q$INSERT INTO identity.nid_blacklist (doc_number_bidx, source, reason, added_by, add_approval_id) VALUES (decode(repeat('cc',32),'hex'),'fraud_decision','Again','b0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001')$q$);
SELECT pg_temp.expect_fail('blacklist removal needs an approval',
 $q$UPDATE identity.nid_blacklist SET removed_at=now(), removed_by='b0000000-0000-4000-8000-000000000002'$q$);

-- ---------------------------------------------------------------- sessions and refresh rotation
INSERT INTO identity.sessions (id, principal_type, user_id, idle_expires_at, absolute_expires_at)
VALUES ('f0000000-0000-4000-8000-000000000001', 'user', 'c0000000-0000-4000-8000-000000000001', now()+interval '7 days', now()+interval '30 days');
SELECT pg_temp.expect_fail('session belongs to exactly one principal type',
 $q$INSERT INTO identity.sessions (principal_type, staff_id, idle_expires_at, absolute_expires_at) VALUES ('user','b0000000-0000-4000-8000-000000000001',now()+interval '1 hour',now()+interval '8 hours')$q$);
SELECT pg_temp.expect_fail('idle expiry cannot exceed absolute expiry',
 $q$INSERT INTO identity.sessions (principal_type, user_id, idle_expires_at, absolute_expires_at) VALUES ('user','c0000000-0000-4000-8000-000000000001',now()+interval '31 days',now()+interval '30 days')$q$);
INSERT INTO identity.refresh_tokens (id, session_id, token_hash)
VALUES ('f1000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001', decode(repeat('01',32),'hex'));
SELECT pg_temp.expect_fail('SEC-SES-02 only one live refresh token per session',
 $q$INSERT INTO identity.refresh_tokens (session_id, token_hash) VALUES ('f0000000-0000-4000-8000-000000000001', decode(repeat('02',32),'hex'))$q$);
-- rotation (SEC-SES-02): mark the old token used, then insert its successor, in one transaction
UPDATE identity.refresh_tokens SET used_at=now(), replaced_by='f1000000-0000-4000-8000-000000000002'
 WHERE id='f1000000-0000-4000-8000-000000000001' AND used_at IS NULL;
INSERT INTO identity.refresh_tokens (id, session_id, token_hash)
VALUES ('f1000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001', decode(repeat('02',32),'hex'));
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.ok('rotation leaves exactly one live token',
 (SELECT count(*) = 1 FROM identity.refresh_tokens WHERE session_id='f0000000-0000-4000-8000-000000000001' AND used_at IS NULL));
SELECT pg_temp.ok('a reused token is detectable (used_at set)',
 (SELECT used_at IS NOT NULL FROM identity.refresh_tokens WHERE token_hash=decode(repeat('01',32),'hex')));
SET CONSTRAINTS ALL DEFERRED;

-- ---------------------------------------------------------------- OTP
SELECT pg_temp.expect_fail('SEC-AUTH-09 attempts cannot exceed the limit',
 $q$INSERT INTO identity.otp_challenges (purpose, user_id, phone_e164, code_hash, attempts, max_attempts, expires_at) VALUES ('step_up','c0000000-0000-4000-8000-000000000001','+8801711000001',decode(repeat('03',32),'hex'),6,5,now()+interval '5 min')$q$);
SELECT pg_temp.expect_fail('register OTP must belong to a pending registration',
 $q$INSERT INTO identity.otp_challenges (purpose, phone_e164, code_hash, max_attempts, expires_at) VALUES ('register_phone','+8801711000009',decode(repeat('03',32),'hex'),5,now()+interval '5 min')$q$);

-- ---------------------------------------------------------------- audit chain
INSERT INTO audit.events (actor_type, actor_id, action, object_type, object_id, reason)
VALUES ('staff', 'b0000000-0000-4000-8000-000000000001', 'kyc.file.viewed', 'kyc_submission', 'd0000000-0000-4000-8000-000000000001', 'review'),
       ('system', NULL, 'session.ended', 'session', 'f0000000-0000-4000-8000-000000000001', 'refresh_reuse'),
       ('user', 'c0000000-0000-4000-8000-000000000001', 'auth.signin.succeeded', 'user', 'c0000000-0000-4000-8000-000000000001', NULL);
SELECT pg_temp.ok('SEC-LOG-02 chain verifies when intact', audit.verify_chain() IS NULL);
SELECT pg_temp.ok('each entry links to the previous hash',
 (SELECT bool_and(e.prev_hash = p.hash) FROM audit.events e JOIN audit.events p ON p.chain_pos = e.chain_pos - 1));
SELECT pg_temp.expect_fail('audit entries cannot be updated',
 $q$UPDATE audit.events SET reason='changed'$q$);
SELECT pg_temp.expect_fail('audit entries cannot be deleted',
 $q$DELETE FROM audit.events$q$);
SELECT pg_temp.expect_fail('action names follow the dotted convention',
 $q$INSERT INTO audit.events (actor_type, action) VALUES ('system','Bad Action')$q$);
-- simulate tampering by someone who bypasses the triggers (superuser)
ALTER TABLE audit.events DISABLE TRIGGER audit_append_only;
UPDATE audit.events SET reason = 'tampered' WHERE action = 'session.ended';
ALTER TABLE audit.events ENABLE TRIGGER audit_append_only;
SELECT pg_temp.ok('SEC-LOG-02 verification finds the tampered entry',
 audit.verify_chain() = (SELECT id FROM audit.events WHERE action='session.ended'));

-- ---------------------------------------------------------------- outbox
INSERT INTO identity.outbox (event_type, aggregate_id, payload)
VALUES ('identity.kyc.verified', 'c0000000-0000-4000-8000-000000000001', '{"userId":"c0000000-0000-4000-8000-000000000001"}');
SELECT pg_temp.expect_fail('outbox event names belong to this unit',
 $q$INSERT INTO identity.outbox (event_type, aggregate_id, payload) VALUES ('orders.order.paid','c0000000-0000-4000-8000-000000000001','{}')$q$);

-- ---------------------------------------------------------------- application role permissions
SET LOCAL ROLE tb_app;
SELECT pg_temp.expect_fail('SEC-INF-03 application role cannot change the schema',
 $q$ALTER TABLE identity.users ADD COLUMN x int$q$);
SELECT pg_temp.expect_fail('SEC-LOG-04 application role cannot update audit entries',
 $q$UPDATE audit.events SET reason='x'$q$);
SELECT pg_temp.expect_fail('application role cannot delete users',
 $q$DELETE FROM identity.users$q$);
SELECT pg_temp.ok('application role can append to the audit log',
 (SELECT true FROM (SELECT 1) t));
INSERT INTO audit.events (actor_type, action) VALUES ('system', 'test.app_role.insert');
RESET ROLE;

ROLLBACK;
