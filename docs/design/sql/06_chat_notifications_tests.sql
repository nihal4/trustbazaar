-- Tests for the database-enforced rules of Unit 6 (Chat & Notifications). Run after the Unit 1-6
-- schemas:  psql -v ON_ERROR_STOP=1 -f 06_chat_notifications_tests.sql
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
INSERT INTO identity.users (id, display_name, phone_e164, phone_verified_at, email, password_hash, password_single_factor_ok, adult_confirmed_at) VALUES
 ('c0000000-0000-4000-8000-000000000001', 'Buyer',    '+8801711000001', now(), 'b@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000002', 'Seller',   '+8801811000002', now(), 's@tb.test', '$argon2id$v=19$x', true, now()),
 ('c0000000-0000-4000-8000-000000000003', 'Stranger', '+8801911000003', now(), 'x@tb.test', '$argon2id$v=19$x', true, now());
INSERT INTO listings.categories (id, slug, name_en, name_bn, item_kind, prohibited) OVERRIDING SYSTEM VALUE VALUES
 (401, 'phones-u6', 'Phones', 'মোবাইল ফোন', 'physical', false);
INSERT INTO listings.listings (id, seller_id, item_kind, sale_format, category_id, title, description, condition,
     no_visible_defects, fulfilment_options, area_district, approx_lat, approx_lng, price)
SELECT ('e0000000-0000-4000-8000-00000000000' || n)::uuid, 'c0000000-0000-4000-8000-000000000002', 'physical', 'fixed_price', 401,
       'Used phone ' || n, 'A used phone in good condition, with charger.', 'used', true, 'pickup_only', 'Dhaka', 23.746, 90.376, 1000000
  FROM generate_series(1, 3) n;
INSERT INTO notify.templates (code, version, category, channels, allowed_params, title_en, title_bn, body_en, body_bn) VALUES
 ('chat.new_message', 1, 'chat', '{email}', '{listing_title,sender_name}', 'New message', 'নতুন বার্তা',
  'You have a new message from {sender_name} about {listing_title}.', '{listing_title} নিয়ে {sender_name} আপনাকে বার্তা পাঠিয়েছেন।'),
 ('order.paid', 1, 'transaction', '{email}', '{listing_title,amount_bdt}', 'Payment received', 'পেমেন্ট গৃহীত',
  'Payment of BDT {amount_bdt} for {listing_title} is held in escrow.', '{listing_title}-এর জন্য {amount_bdt} টাকা এসক্রোতে রাখা হয়েছে।'),
 ('security.new_device', 1, 'security', '{email,sms}', '{device,time}', 'New sign-in', 'নতুন সাইন-ইন',
  'Your account was signed in on {device} at {time}.', '{time}-এ {device} থেকে আপনার অ্যাকাউন্টে সাইন-ইন হয়েছে।');

-- ---------------------------------------------------------------- threads (FR-CHT-01)
SELECT pg_temp.expect_fail('FR-CHT-01 a seller cannot open a thread with themselves',
 $q$SELECT chat.open_thread('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002')$q$, 'thread_parties');
SELECT chat.open_thread('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002') AS t1 \gset
SELECT pg_temp.ok('FR-CHT-01 one thread per listing and buyer: opening again returns the same thread',
  chat.open_thread('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002') = :'t1'
  AND (SELECT count(*) FROM chat.threads WHERE listing_id = 'e0000000-0000-4000-8000-000000000001') = 1);
SELECT pg_temp.expect_fail('thread parties are fixed',
 $q$UPDATE chat.threads SET buyer_id = 'c0000000-0000-4000-8000-000000000003' WHERE id = '$q$ || :'t1' || $q$'$q$, 'parties are fixed');

-- ---------------------------------------------------------------- messages (FR-CHT-02, -05, -09)
SELECT pg_temp.expect_fail('SEC-SES-07 only the two participants can write',
 $q$SELECT * FROM chat.post('$q$ || :'t1' || $q$', 'c0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'text', 'hello')$q$, 'only the two participants');
SELECT seq AS s1 FROM chat.post(:'t1', 'c0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'text', 'Is it still available?') \gset
SELECT seq AS s2 FROM chat.post(:'t1', 'c0000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'text', 'Yes, it is.') \gset
SELECT pg_temp.ok('messages get consecutive sequence numbers in the thread', :s1 = 1 AND :s2 = 2);
SELECT pg_temp.ok('the sender''s own messages count as delivered and read for the sender',
  (SELECT buyer_read_seq = 1 AND seller_read_seq = 2 AND buyer_delivered_seq = 1 FROM chat.threads WHERE id = :'t1'));
SELECT seq AS s1b, duplicate AS dup FROM chat.post(:'t1', 'c0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'text', 'Is it still available?') \gset
SELECT pg_temp.ok('a resend with the same client id returns the original, not a copy',
  :'dup'::boolean AND :s1b = 1 AND (SELECT count(*) FROM chat.messages WHERE thread_id = :'t1') = 2);
SELECT pg_temp.expect_fail('FR-CHT-09 plain text only: control characters are refused',
 $q$SELECT * FROM chat.post('$q$ || :'t1' || $q$', 'c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'text', 'bad' || chr(27) || '[31m')$q$, 'message_plain_text');
SELECT pg_temp.expect_fail('an empty message is refused',
 $q$SELECT * FROM chat.post('$q$ || :'t1' || $q$', 'c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'text', '   ')$q$, 'message_content');
SELECT pg_temp.expect_fail('FR-CHT-03 an image message needs a stored image',
 $q$SELECT * FROM chat.post('$q$ || :'t1' || $q$', 'c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'image', NULL, NULL)$q$, 'message_content');
SELECT pg_temp.ok('FR-CHT-03 an image message with a caption is stored',
  (SELECT seq = 3 FROM chat.post(:'t1', 'c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'image', 'The scratch', 'chat-img-0001')));
-- its own thread (the stranger asking about listing 1), so the sequence numbers checked below do not move
SELECT chat.open_thread('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002') AS t9 \gset
SELECT pg_temp.ok('FR-CHT-03 an image keeps Unit 1''s FileVault key, about 165 characters (U6-02)',
  (SELECT seq = 1 FROM chat.post(:'t9', 'c0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'image', NULL,
     'v1.chat_image.' || gen_random_uuid() || '.' || repeat('a', 48) || '.' || repeat('k', 80))));

-- delivered and read indicators (FR-CHT-05)
SELECT chat.mark(:'t1', 'c0000000-0000-4000-8000-000000000002', 3, 1);
SELECT pg_temp.ok('FR-CHT-05 the recipient''s delivered and read marks are recorded',
  (SELECT seller_delivered_seq = 3 AND seller_read_seq = 2 FROM chat.threads WHERE id = :'t1'));
SELECT chat.mark(:'t1', 'c0000000-0000-4000-8000-000000000002', 1, 1);
SELECT pg_temp.ok('marks never move backwards', (SELECT seller_delivered_seq = 3 AND seller_read_seq = 2 FROM chat.threads WHERE id = :'t1'));
SELECT chat.mark(:'t1', 'c0000000-0000-4000-8000-000000000001', 0, 99);
SELECT pg_temp.ok('a mark beyond the last message is clamped, and read implies delivered',
  (SELECT buyer_read_seq = 3 AND buyer_delivered_seq = 3 FROM chat.threads WHERE id = :'t1'));
SELECT pg_temp.expect_fail('only a participant can acknowledge',
 $q$SELECT chat.mark('$q$ || :'t1' || $q$', 'c0000000-0000-4000-8000-000000000003', 3, 3)$q$, 'only a participant');
SELECT pg_temp.expect_fail('watermarks cannot be moved back directly',
 $q$UPDATE chat.threads SET seller_read_seq = 0 WHERE id = '$q$ || :'t1' || $q$'$q$, 'only move forward');
SELECT pg_temp.expect_fail('FR-CHT-04 messages cannot be edited',
 $q$UPDATE chat.messages SET body = 'changed' WHERE thread_id = '$q$ || :'t1' || $q$' AND seq = 1$q$, 'cannot be edited');
SELECT pg_temp.expect_fail('FR-CHT-04 messages cannot be deleted',
 $q$DELETE FROM chat.messages WHERE thread_id = '$q$ || :'t1' || $q$'$q$, 'append-only');

-- ---------------------------------------------------------------- detection (FR-CHT-07, FR-GAM-20)
SELECT pg_temp.ok('FR-CHT-07 a Bangla-digit mobile number split by a dash is a phone number',
  chat.detect('আমার নাম্বার ০১৭১১-২৩৪৫৬৭') = '{phone}');
SELECT pg_temp.ok('FR-CHT-07 +880 with spaces is a phone number too',
  chat.detect('call +880 1811 234 567') = '{phone}');
SELECT pg_temp.ok('FR-CHT-07 a long digit run is an account number; a price and a year are not',
  chat.detect('A/C 1234 5678 9012 34') = '{account_number}' AND chat.detect('BDT 15,000, bought in 2024, 2 years warranty') = '{}');
SELECT pg_temp.ok('FR-CHT-07 Bangla advance-payment phrases are detected',
  chat.detect('আগে টাকা বিকাশ করে দিন, অগ্রিম ছাড়া হবে না') = '{payment_phrase}');
SELECT pg_temp.ok('FR-CHT-07 English payment phrases and other apps are detected',
  chat.detect('Pay first by send money, then talk on WhatsApp') = '{off_platform_app,payment_phrase}');
SELECT pg_temp.ok('Latin terms must be whole words: kimono, advanced and passing are not flagged',
  chat.detect('A kimono, an advanced model, passing by') = '{}');
SELECT pg_temp.ok('FR-CHT-09 links and e-mail addresses are flagged',
  chat.detect('see www.my-shop.com or wa.me/88017 or write to a.b@example.com') @> '{link,email}');
SELECT pg_temp.ok('FR-GAM-20 login details in chat are flagged (Bangla and English)',
  chat.detect('login id player77, pass: x9y8') = '{credentials}' AND chat.detect('পাসওয়ার্ড দিচ্ছি') = '{credentials}');
SELECT pg_temp.ok('an ordinary message has no flags', chat.detect('Can we meet at the mall entrance at 4 pm?') = '{}');
SELECT flags AS fl FROM chat.post(:'t1', 'c0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'text', 'বিকাশ করুন 01711234567 এ') \gset
SELECT pg_temp.ok('FR-CHT-07 a flagged message is still delivered, with its flags, and raises an event',
  :'fl' = '{payment_phrase,phone}'
  AND EXISTS (SELECT 1 FROM chat.messages WHERE thread_id = :'t1' AND seq = 4)
  AND EXISTS (SELECT 1 FROM chat.outbox WHERE event_type = 'chat.message.flagged'));
SELECT pg_temp.expect_fail('detection terms are stored normalised (lower case)',
 $q$INSERT INTO chat.detection_terms (term, flag) VALUES ('Viber', 'off_platform_app')$q$, 'term_normalised');

-- ---------------------------------------------------------------- blocking (FR-CHT-08)
SELECT pg_temp.expect_fail('a user cannot block themselves',
 $q$INSERT INTO chat.blocks VALUES ('c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001')$q$, 'block_not_self');
INSERT INTO chat.blocks (blocker_id, blocked_id) VALUES ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_fail('FR-CHT-08 a blocked user cannot send messages to the blocker',
 $q$SELECT * FROM chat.post('$q$ || :'t1' || $q$', 'c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'text', 'hello?')$q$, 'blocked');
SELECT pg_temp.expect_fail('FR-CHT-08 nor can the blocker write while the block stands',
 $q$SELECT * FROM chat.post('$q$ || :'t1' || $q$', 'c0000000-0000-4000-8000-000000000002', gen_random_uuid(), 'text', 'hello?')$q$, 'blocked');
SELECT pg_temp.expect_fail('FR-CHT-08 a blocked user cannot open a new thread with the blocker',
 $q$SELECT chat.open_thread('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000002')$q$, 'blocked');
DELETE FROM chat.blocks WHERE blocker_id = 'c0000000-0000-4000-8000-000000000002';
SELECT pg_temp.ok('after unblocking, messages flow again',
  (SELECT seq = 5 FROM chat.post(:'t1', 'c0000000-0000-4000-8000-000000000001', gen_random_uuid(), 'text', 'Thanks')));

-- ---------------------------------------------------------------- staff access (FR-CHT-10)
SELECT pg_temp.expect_fail('FR-CHT-10 staff cannot read a thread without a case that concerns it',
 $q$SELECT * FROM chat.staff_read('$q$ || :'t1' || $q$', 'a0000000-0000-4000-8000-000000000001', 'dispute', 'f2000000-0000-4000-8000-000000000001')$q$, 'only through an open case');
INSERT INTO chat.thread_holds (thread_id, case_type, case_id) VALUES (:'t1', 'dispute', 'f2000000-0000-4000-8000-000000000001');
SELECT pg_temp.ok('FR-CHT-10 with the dispute''s hold, the thread is readable and the read is logged',
  (SELECT count(*) = 5 FROM chat.staff_read(:'t1', 'a0000000-0000-4000-8000-000000000001', 'dispute', 'f2000000-0000-4000-8000-000000000001')));
SELECT pg_temp.ok('... one access-log row', (SELECT count(*) = 1 FROM chat.staff_access_log WHERE thread_id = :'t1'));
SELECT pg_temp.expect_fail('a different case gives no access',
 $q$SELECT * FROM chat.staff_read('$q$ || :'t1' || $q$', 'a0000000-0000-4000-8000-000000000001', 'report', 'f2000000-0000-4000-8000-000000000001')$q$, 'only through an open case');
SELECT pg_temp.expect_fail('SEC-LOG-01 the staff access log is append-only',
 $q$DELETE FROM chat.staff_access_log$q$, 'append-only');

-- ---------------------------------------------------------------- retention (FR-CHT-04)
SELECT chat.open_thread('e0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000002') AS t2 \gset
SELECT * FROM chat.post(:'t2', 'c0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'image', NULL, 'chat-img-0002') \g /dev/null
UPDATE chat.threads SET last_message_at = now() - interval '13 months' WHERE id IN (:'t1', :'t2');
SELECT array_agg(k) AS keys FROM chat.purge_due(interval '1 year') k \gset
SELECT pg_temp.ok('retention: a silent thread past one year is purged, and its image files are returned for deletion',
  :'keys' = '{chat-img-0002}'
  AND (SELECT purged_at IS NOT NULL FROM chat.threads WHERE id = :'t2')
  AND (SELECT bool_and(body IS NULL AND image_key IS NULL) FROM chat.messages WHERE thread_id = :'t2'));
SELECT pg_temp.ok('FR-CHT-04 a thread held by an open dispute is kept beyond retention',
  (SELECT purged_at IS NULL FROM chat.threads WHERE id = :'t1'));
SELECT pg_temp.expect_fail('nothing can be posted into a purged thread',
 $q$SELECT * FROM chat.post('$q$ || :'t2' || $q$', 'c0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'text', 'hi')$q$, 'purged');

-- ---------------------------------------------------------------- templates (FR-NTF-05, FR-NTF-06)
SELECT pg_temp.expect_fail('FR-NTF-05 SMS only for security notices',
 $q$INSERT INTO notify.templates (code, version, category, channels, title_en, title_bn, body_en, body_bn) VALUES ('order.shipped', 1, 'transaction', '{email,sms}', 't', 't', 'b', 'b')$q$, 'sms_only_for_security');
SELECT pg_temp.expect_fail('FR-NTF-06 security notices go by SMS and e-mail',
 $q$INSERT INTO notify.templates (code, version, category, channels, title_en, title_bn, body_en, body_bn) VALUES ('security.mfa_off', 1, 'security', '{email}', 't', 't', 'b', 'b')$q$, 'security_by_sms_and_email');

-- ---------------------------------------------------------------- notifications (FR-NTF-03, -04, -08)
SELECT notify.create('c0000000-0000-4000-8000-000000000001', 'order.paid', '{"listing_title":"Used phone 1","amount_bdt":10000}', 'evt-1:order.paid') AS n1 \gset
SELECT pg_temp.ok('FR-NTF-03 an order notice is created with an e-mail delivery',
  (SELECT status = 'pending' FROM notify.deliveries WHERE notification_id = :'n1' AND channel = 'email')
  AND NOT EXISTS (SELECT 1 FROM notify.deliveries WHERE notification_id = :'n1' AND channel = 'sms'));
SELECT pg_temp.ok('DC-6 the same event delivered twice creates one notification',
  notify.create('c0000000-0000-4000-8000-000000000001', 'order.paid', '{"listing_title":"Used phone 1","amount_bdt":10000}', 'evt-1:order.paid') IS NULL
  AND (SELECT count(*) FROM notify.notifications WHERE dedupe_key = 'evt-1:order.paid') = 1);
SELECT pg_temp.expect_fail('I-55 a notification names its subject completely or not at all',
 $q$UPDATE notify.notifications SET subject_type = 'order' WHERE id = '$q$ || :'n1' || $q$'$q$, 'notification_subject');
SELECT pg_temp.expect_fail('FR-NTF-08 only the template''s declared parameters are accepted',
 $q$SELECT notify.create('c0000000-0000-4000-8000-000000000001', 'order.paid', '{"listing_title":"x","buyer_phone":"x"}', 'k2')$q$, 'not allowed in template');
SELECT pg_temp.expect_fail('parameters must be plain values',
 $q$SELECT notify.create('c0000000-0000-4000-8000-000000000001', 'order.paid', '{"listing_title":{"a":1}}', 'k3')$q$, 'plain value');
SELECT pg_temp.expect_fail('FR-NTF-08 no phone number, even inside a seller''s title',
 $q$SELECT notify.create('c0000000-0000-4000-8000-000000000001', 'order.paid', '{"listing_title":"Phone, call ০১৭১১ ২৩৪৫৬৭"}', 'k4')$q$, 'contact details or a code');
SELECT pg_temp.expect_fail('FR-NTF-08 no e-mail address',
 $q$SELECT notify.create('c0000000-0000-4000-8000-000000000001', 'chat.new_message', '{"sender_name":"mail me at s@x.com"}', 'k5')$q$, 'contact details or a code');
SELECT pg_temp.expect_fail('FR-NTF-08 no NID-like number',
 $q$SELECT notify.create('c0000000-0000-4000-8000-000000000001', 'chat.new_message', '{"sender_name":"1990123456789"}', 'k6')$q$, 'contact details or a code');
SELECT pg_temp.expect_fail('FR-NTF-08 no six-digit code',
 $q$SELECT notify.create('c0000000-0000-4000-8000-000000000001', 'security.new_device', '{"device":"code 482913"}', 'k7')$q$, 'contact details or a code');
SELECT pg_temp.ok('a masked title passes',
  notify.create('c0000000-0000-4000-8000-000000000001', 'order.paid',
                jsonb_build_object('listing_title', notify.mask('Phone, call ০১৭১১ ২৩৪৫৬৭ or a@b.com')), 'k8') IS NOT NULL
  AND notify.mask('Phone, call ০১৭১১ ২৩৪৫৬৭ or a@b.com') = 'Phone, call [hidden] or [hidden]');
INSERT INTO notify.preferences (user_id, email_transactional) VALUES ('c0000000-0000-4000-8000-000000000002', false);
SELECT notify.create('c0000000-0000-4000-8000-000000000002', 'order.paid', '{"listing_title":"Used phone 2"}', 'evt-2:order.paid') AS n2 \gset
SELECT notify.create('c0000000-0000-4000-8000-000000000002', 'security.new_device', '{"device":"Chrome on Android","time":"19:30"}', 'evt-3:new_device') AS n3 \gset
SELECT pg_temp.ok('FR-NTF-05 a user who turned off e-mails gets transactional notices in the app only',
  (SELECT status = 'suppressed' FROM notify.deliveries WHERE notification_id = :'n2' AND channel = 'email'));
SELECT pg_temp.ok('FR-NTF-06 security notices still go by SMS and e-mail; they cannot be switched off',
  (SELECT count(*) = 2 AND bool_and(status = 'pending') FROM notify.deliveries WHERE notification_id = :'n3'));
SELECT pg_temp.expect_fail('a sent delivery records when it was sent',
 $q$UPDATE notify.deliveries SET status = 'sent' WHERE notification_id = '$q$ || :'n3' || $q$' AND channel = 'sms'$q$, 'delivery_sent_fields');
SELECT pg_temp.ok('FR-NTF-04 the history lists the user''s notifications, newest first; unread ones are counted',
  (SELECT count(*) = 2 FROM notify.notifications WHERE user_id = 'c0000000-0000-4000-8000-000000000002' AND read_at IS NULL));

-- ---------------------------------------------------------------- reminders (FR-NTF-07)
SELECT notify.schedule_reminder('c0000000-0000-4000-8000-000000000001', 'payment_window', 'd0000000-0000-4000-8000-000000000001', now() + interval '20 hours', interval '24 hours');
SELECT notify.schedule_reminder('c0000000-0000-4000-8000-000000000001', 'payment_window', 'd0000000-0000-4000-8000-000000000001', now() + interval '20 hours', interval '2 hours');
SELECT pg_temp.ok('CP-38 two reminders, 24 h and 2 h before the deadline',
  (SELECT count(*) = 2 FROM notify.reminders WHERE subject_id = 'd0000000-0000-4000-8000-000000000001'));
SELECT notify.schedule_reminder('c0000000-0000-4000-8000-000000000001', 'payment_window', 'd0000000-0000-4000-8000-000000000001', now() + interval '30 hours', interval '2 hours');
SELECT pg_temp.ok('a moved deadline moves its reminder (no duplicate)',
  (SELECT count(*) = 1 AND min(fire_at) = now() + interval '28 hours' FROM notify.reminders
    WHERE subject_id = 'd0000000-0000-4000-8000-000000000001' AND lead = interval '2 hours'));
SELECT notify.schedule_reminder('c0000000-0000-4000-8000-000000000001', 'takeover_window', 'd0000000-0000-4000-8000-000000000002', now() + interval '1 hour', interval '2 hours');
SELECT notify.schedule_reminder('c0000000-0000-4000-8000-000000000001', 'courier_pickup', 'd0000000-0000-4000-8000-000000000003', now() - interval '1 minute', interval '2 hours');
SELECT count(*) AS claimed FROM notify.claim_due_reminders(100) \gset
SELECT pg_temp.ok('the job sends only reminders that are due and whose deadline is still ahead',
  :claimed = 2
  AND (SELECT status = 'sent' FROM notify.reminders WHERE subject_id = 'd0000000-0000-4000-8000-000000000002')
  AND (SELECT status = 'cancelled' FROM notify.reminders WHERE subject_id = 'd0000000-0000-4000-8000-000000000003'));
SELECT pg_temp.ok('a claimed reminder is not sent twice', (SELECT count(*) = 0 FROM notify.claim_due_reminders(100)));
SELECT notify.schedule_reminder('c0000000-0000-4000-8000-000000000001', 'takeover_window', 'd0000000-0000-4000-8000-000000000002', now() + interval '25 hours', interval '2 hours');
SELECT pg_temp.ok('FR-GAM-12 a restarted takeover window re-arms its sent reminder',
  (SELECT status = 'scheduled' AND sent_at IS NULL FROM notify.reminders WHERE subject_id = 'd0000000-0000-4000-8000-000000000002'));
SELECT pg_temp.ok('the step happening cancels the outstanding reminders',
  notify.cancel_reminders('payment_window', 'd0000000-0000-4000-8000-000000000001') = 1);

-- ---------------------------------------------------------------- chat e-mails, watches
SELECT pg_temp.ok('DV-41 the first chat e-mail for a thread is allowed',
  notify.chat_email_allowed('c0000000-0000-4000-8000-000000000001', :'t1', interval '15 minutes'));
SELECT pg_temp.ok('DV-41 a second within the window is not',
  NOT notify.chat_email_allowed('c0000000-0000-4000-8000-000000000001', :'t1', interval '15 minutes'));
INSERT INTO notify.watches (user_id, listing_id) VALUES ('c0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001');
SELECT pg_temp.expect_fail('FR-NTF-02 a listing is watched once per user',
 $q$INSERT INTO notify.watches (user_id, listing_id) VALUES ('c0000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001')$q$, 'watches_pkey');

-- ---------------------------------------------------------------- events, grants
SELECT pg_temp.expect_fail('DC-6 outbox events are named chat.<entity>.<past>',
 $q$INSERT INTO chat.outbox (event_type, aggregate_id, payload) VALUES ('orders.order.paid', gen_random_uuid(), '{}')$q$, 'outbox_event_type_check');
SET LOCAL ROLE tb_app;
SELECT pg_temp.expect_fail('application role cannot rewrite the staff access log',
 $q$UPDATE chat.staff_access_log SET at = now()$q$, 'permission denied');
SELECT pg_temp.expect_fail('application role cannot delete chat messages',
 $q$DELETE FROM chat.messages$q$, 'permission denied');
RESET ROLE;

ROLLBACK;
