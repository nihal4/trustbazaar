import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 7: a frozen copy of docs/design/sql/07_disputes_trust_staff.sql as of this migration (I-60, NFR-MNT-04).
// Never edit an applied migration: a later change to the design file comes as a new migration.
// Runs as tb_owner (SEC-INF-03). down() drops the schemas disputes, trust, staff; extensions and roles stay.
export class DisputesTrustStaff1793491200007 implements MigrationInterface {
  name = 'DisputesTrustStaff1793491200007';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP SCHEMA IF EXISTS disputes, trust, staff CASCADE');
  }
}

const SQL = String.raw`-- =====================================================================
-- TrustBazaar - Unit 7: Disputes, Trust & Safety, Staff Tools - PostgreSQL 15 schema
-- Design document: docs/design/07_disputes_trust_staff.pdf
-- Requirements: SRS v2.0 FR-DSP-01..12, FR-TNS-01..09, FR-REV-01..07, FR-OPS-01..09,
--   FR-PRV-03, FR-PRV-06, FR-GAM-18 (sanction side); SEC-LOG-01 (case views), SEC-IRM-04.
-- Depends on: 01_identity_access.sql (identity.users, identity.staff_accounts,
--   identity.approvals, identity.forbid_change), 02_orders_payments.sql (orders.orders).
-- Conventions DC-1..DC-14. No function reads another unit's tables (DC-1); facts such as
-- "the dispute window is open" arrive as arguments from the owning unit's port.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS disputes;
CREATE SCHEMA IF NOT EXISTS trust;
CREATE SCHEMA IF NOT EXISTS staff;

-- =====================================================================
-- DISPUTES (FR-DSP)
-- =====================================================================
CREATE TYPE disputes.dispute_type AS ENUM
  ('not_as_described', 'damaged', 'not_received', 'credentials_invalid', 'seller_recovery', 'other');   -- FR-DSP-01
CREATE TYPE disputes.status AS ENUM
  ('open', 'awaiting_seller', 'under_review', 'awaiting_return', 'decided', 'withdrawn');               -- FR-DSP-09
CREATE TYPE disputes.outcome AS ENUM ('release', 'full_refund', 'partial_refund', 'refund_after_return'); -- FR-DSP-06
CREATE TYPE disputes.party AS ENUM ('buyer', 'seller');
CREATE TYPE disputes.actor AS ENUM ('buyer', 'seller', 'operator', 'system');

CREATE TABLE disputes.disputes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            uuid NOT NULL REFERENCES orders.orders(id),
  buyer_id            uuid NOT NULL REFERENCES identity.users(id),
  seller_id           uuid NOT NULL REFERENCES identity.users(id),
  item_kind           varchar(12) NOT NULL CHECK (item_kind IN ('physical', 'game_account')),
  type                disputes.dispute_type NOT NULL,
  description         varchar(4000) NOT NULL CHECK (length(btrim(description)) >= 20),
  item_price          bigint NOT NULL CHECK (item_price > 0),        -- from the order, for partial refunds
  amount_collected    bigint NOT NULL CHECK (amount_collected >= item_price),   -- for the CP-30 threshold
  status              disputes.status NOT NULL DEFAULT 'open',
  opened_by           disputes.actor NOT NULL DEFAULT 'buyer',       -- system: re-key overdue (Unit 5)
  opened_at           timestamptz NOT NULL DEFAULT now(),
  seller_due_at       timestamptz NOT NULL,                          -- opened_at + CP-20
  info_due_at         timestamptz,                                   -- awaiting_seller: operator's request
  review_started_at   timestamptz,
  decision_target_at  timestamptz,                                   -- review start + CP-21
  assigned_to         uuid REFERENCES identity.staff_accounts(id),
  outcome             disputes.outcome,
  item_refund         bigint,                                        -- partial refund (FR-PAY-11)
  return_fare         bigint,
  return_fare_payer   disputes.party,
  decision_reason     text,
  decided_by          uuid REFERENCES identity.staff_accounts(id),
  decided_at          timestamptz,
  approval_id         uuid REFERENCES identity.approvals(id),        -- four-eyes (CP-30)
  closed_at           timestamptz,
  withdrawn_at        timestamptz,
  last_actor          disputes.actor NOT NULL DEFAULT 'buyer',
  last_actor_id       uuid,
  last_reason         text,
  CONSTRAINT dispute_parties CHECK (buyer_id <> seller_id),
  -- game types only for game accounts, physical types only for physical items (FR-DSP-01)
  CONSTRAINT dispute_type_fits_item CHECK (
         (item_kind = 'game_account' AND type IN ('credentials_invalid', 'seller_recovery', 'other'))
      OR (item_kind = 'physical' AND type IN ('not_as_described', 'damaged', 'not_received', 'other'))),
  CONSTRAINT dispute_review_fields CHECK (status IN ('open', 'withdrawn') OR (review_started_at IS NOT NULL AND decision_target_at IS NOT NULL)),
  CONSTRAINT dispute_info_fields CHECK ((status = 'awaiting_seller') = (info_due_at IS NOT NULL)),
  CONSTRAINT dispute_decision_fields CHECK ((status IN ('awaiting_return', 'decided')) =
         (outcome IS NOT NULL AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(btrim(coalesce(decision_reason, ''))) >= 20)),
  CONSTRAINT dispute_partial_amount CHECK ((outcome = 'partial_refund') = (item_refund IS NOT NULL)
         AND (item_refund IS NULL OR (item_refund > 0 AND item_refund < item_price))),
  CONSTRAINT dispute_return_fields CHECK ((outcome = 'refund_after_return') = (return_fare IS NOT NULL AND return_fare_payer IS NOT NULL)
         AND (return_fare IS NULL OR return_fare >= 0)),
  CONSTRAINT dispute_return_status CHECK (status <> 'awaiting_return' OR outcome = 'refund_after_return'),
  CONSTRAINT dispute_closed_fields CHECK ((status = 'decided') = (closed_at IS NOT NULL)),
  CONSTRAINT dispute_withdrawn_fields CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL))
);
-- FR-DSP-11: one dispute open on an order at a time
CREATE UNIQUE INDEX disputes_one_open ON disputes.disputes (order_id) WHERE status NOT IN ('decided', 'withdrawn');
CREATE INDEX disputes_queue ON disputes.disputes (opened_at) WHERE status NOT IN ('decided', 'withdrawn');
CREATE INDEX disputes_seller_due ON disputes.disputes (seller_due_at) WHERE status = 'open';

CREATE FUNCTION disputes.dispute_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'a dispute starts as open' USING ERRCODE = 'check_violation'; END IF;
    -- FR-DSP-10: a withdrawn dispute cannot be reopened with the same type
    IF EXISTS (SELECT 1 FROM disputes.disputes WHERE order_id = NEW.order_id AND type = NEW.type AND status = 'withdrawn') THEN
      RAISE EXCEPTION 'a dispute of this type was withdrawn and cannot be reopened' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.order_id, NEW.buyer_id, NEW.seller_id, NEW.item_kind, NEW.type, NEW.description, NEW.item_price, NEW.amount_collected, NEW.opened_at, NEW.opened_by)
     IS DISTINCT FROM (OLD.order_id, OLD.buyer_id, OLD.seller_id, OLD.item_kind, OLD.type, OLD.description, OLD.item_price, OLD.amount_collected, OLD.opened_at, OLD.opened_by) THEN
    RAISE EXCEPTION 'what a dispute is about is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('decided', 'withdrawn') THEN RAISE EXCEPTION 'dispute is closed' USING ERRCODE = 'check_violation'; END IF;
  IF OLD.outcome IS NOT NULL AND (NEW.outcome, NEW.item_refund, NEW.return_fare, NEW.return_fare_payer, NEW.decided_by, NEW.decided_at, NEW.decision_reason)
       IS DISTINCT FROM (OLD.outcome, OLD.item_refund, OLD.return_fare, OLD.return_fare_payer, OLD.decided_by, OLD.decided_at, OLD.decision_reason) THEN
    RAISE EXCEPTION 'a decision is final' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('open'::disputes.status, 'under_review'::disputes.status), ('open', 'withdrawn'),
       ('under_review', 'awaiting_seller'), ('under_review', 'decided'), ('under_review', 'awaiting_return'), ('under_review', 'withdrawn'),
       ('awaiting_seller', 'under_review'), ('awaiting_seller', 'withdrawn'),
       ('awaiting_return', 'decided'))) THEN
    RAISE EXCEPTION 'dispute % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- FR-DSP-06/CP-30: a decision on BDT 20,000 or more needs an executed four-eyes approval
  IF NEW.outcome IS NOT NULL AND OLD.outcome IS NULL AND NEW.amount_collected >= 2000000 AND NEW.approval_id IS NULL THEN
    RAISE EXCEPTION 'decisions on BDT 20,000 or more need four-eyes approval (CP-30)' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (NEW.last_actor_id IS NOT DISTINCT FROM OLD.last_actor_id
       AND NEW.last_actor IS NOT DISTINCT FROM OLD.last_actor AND NEW.last_reason IS NOT DISTINCT FROM OLD.last_reason
       AND NEW.last_actor <> 'system') THEN
    RAISE EXCEPTION 'every status change names its actor and reason (FR-DSP-09)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dispute_guard BEFORE INSERT OR UPDATE ON disputes.disputes FOR EACH ROW EXECUTE FUNCTION disputes.dispute_guard();

CREATE TABLE disputes.history (                                                -- FR-DSP-09, append-only
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispute_id   uuid NOT NULL REFERENCES disputes.disputes(id),
  from_status  disputes.status,
  to_status    disputes.status NOT NULL,
  actor        disputes.actor NOT NULL,
  actor_id     uuid,
  reason       text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX history_dispute ON disputes.history (dispute_id, id);
CREATE TRIGGER history_append_only BEFORE UPDATE OR DELETE ON disputes.history FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

CREATE FUNCTION disputes.log_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO disputes.history (dispute_id, from_status, to_status, actor, actor_id, reason)
    VALUES (NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, NEW.last_actor, NEW.last_actor_id, NEW.last_reason);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER dispute_log AFTER INSERT OR UPDATE ON disputes.disputes FOR EACH ROW EXECUTE FUNCTION disputes.log_status();

-- statements and evidence of both parties (FR-DSP-01, FR-DSP-04); append-only
CREATE TABLE disputes.statements (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispute_id  uuid NOT NULL REFERENCES disputes.disputes(id),
  party       disputes.party NOT NULL,
  text        varchar(4000) NOT NULL CHECK (length(btrim(text)) >= 1),
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE disputes.evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   uuid NOT NULL REFERENCES disputes.disputes(id),
  party        disputes.party NOT NULL,
  storage_key  varchar(80) NOT NULL UNIQUE,        -- Unit 1 FileVault, evidence purpose (encrypted)
  sha256       bytea NOT NULL CHECK (octet_length(sha256) = 32),
  mime         varchar(30) NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size    integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),     -- CP-33
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER statements_append_only BEFORE UPDATE OR DELETE ON disputes.statements FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();
CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON disputes.evidence FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

CREATE FUNCTION disputes.evidence_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st disputes.status;
BEGIN
  SELECT status INTO st FROM disputes.disputes WHERE id = NEW.dispute_id FOR UPDATE;
  IF st IN ('decided', 'withdrawn', 'awaiting_return') THEN
    RAISE EXCEPTION 'evidence is accepted only while the dispute is being considered' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(*) FROM disputes.evidence WHERE dispute_id = NEW.dispute_id) >= 10 THEN
    RAISE EXCEPTION 'at most 10 evidence files per dispute (CP-33)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_limit BEFORE INSERT ON disputes.evidence FOR EACH ROW EXECUTE FUNCTION disputes.evidence_limit();

CREATE TABLE disputes.outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      varchar(80) NOT NULL CHECK (event_type ~ '^(disputes|trust|staff)\.[a-z_]+\.[a-z_]+$'),
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz
);
CREATE INDEX unit7_outbox_pending ON disputes.outbox (next_attempt_at) WHERE dispatched_at IS NULL;

-- ---------------------------------------------------------------- dispute operations
-- FR-DSP-01: the window check (Unit 2 EscrowQuery.disputeAllowed, Unit 4 notReceivedAllowed,
-- Unit 5 credentialsInvalidAllowed) is passed in; the service then freezes the escrow in the
-- same transaction (DC-13).
CREATE FUNCTION disputes.open(p_order uuid, p_buyer uuid, p_seller uuid, p_item_kind varchar, p_type disputes.dispute_type,
                              p_description text, p_item_price bigint, p_collected bigint, p_window_ok boolean,
                              p_seller_window interval, p_by disputes.actor DEFAULT 'buyer')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE did uuid;
BEGIN
  IF NOT p_window_ok THEN
    RAISE EXCEPTION 'a dispute of this type cannot be opened now (outside its window, or the payment is not held)'
      USING ERRCODE = 'check_violation';
  END IF;
  BEGIN
    INSERT INTO disputes.disputes (order_id, buyer_id, seller_id, item_kind, type, description, item_price, amount_collected,
                                   seller_due_at, opened_by, last_actor, last_actor_id, last_reason)
    VALUES (p_order, p_buyer, p_seller, p_item_kind, p_type, p_description, p_item_price, p_collected,
            now() + p_seller_window, p_by, p_by, CASE WHEN p_by = 'buyer' THEN p_buyer END, 'opened')
    RETURNING id INTO did;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'a dispute is already open on this order (FR-DSP-11)' USING ERRCODE = 'check_violation';
  END;
  INSERT INTO disputes.outbox (event_type, aggregate_id, payload)
  VALUES ('disputes.dispute.opened', did, jsonb_build_object('orderId', p_order, 'type', p_type, 'sellerDueAt', now() + p_seller_window));
  RETURN did;
END $$;

-- FR-DSP-04: the seller responds within CP-20 (or within the operator's request)
CREATE FUNCTION disputes.seller_respond(p_dispute uuid, p_seller uuid, p_text text, p_review_target interval) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d disputes.disputes;
BEGIN
  SELECT * INTO d FROM disputes.disputes WHERE id = p_dispute FOR UPDATE;
  IF NOT FOUND OR p_seller <> d.seller_id THEN RAISE EXCEPTION 'only the seller responds' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF d.status NOT IN ('open', 'awaiting_seller') THEN RAISE EXCEPTION 'no response is expected now' USING ERRCODE = 'check_violation'; END IF;
  IF now() >= coalesce(d.info_due_at, d.seller_due_at) THEN
    RAISE EXCEPTION 'the response window has ended; the operator decides on the evidence available' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO disputes.statements (dispute_id, party, text) VALUES (p_dispute, 'seller', p_text);
  UPDATE disputes.disputes SET status = 'under_review', info_due_at = NULL,
         review_started_at = coalesce(review_started_at, now()),
         decision_target_at = coalesce(decision_target_at, now() + p_review_target),
         last_actor = 'seller', last_actor_id = p_seller, last_reason = 'seller responded'
   WHERE id = p_dispute;
END $$;

-- the CP-20 job: no response in time, so the review starts on the evidence available
CREATE FUNCTION disputes.seller_window_ended(p_dispute uuid, p_review_target interval) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE disputes.disputes SET status = 'under_review', info_due_at = NULL,
         review_started_at = coalesce(review_started_at, now()), decision_target_at = coalesce(decision_target_at, now() + p_review_target),
         last_actor = 'system', last_actor_id = NULL, last_reason = 'response window ended'
   WHERE id = p_dispute AND ((status = 'open' AND now() >= seller_due_at) OR (status = 'awaiting_seller' AND now() >= info_due_at));
  RETURN FOUND;
END $$;

-- the operator asks the seller for more information (FR-DSP-09 awaiting_seller)
CREATE FUNCTION disputes.request_info(p_dispute uuid, p_staff uuid, p_due interval, p_note text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE disputes.disputes SET status = 'awaiting_seller', info_due_at = now() + p_due,
         last_actor = 'operator', last_actor_id = p_staff, last_reason = p_note
   WHERE id = p_dispute AND status = 'under_review' AND assigned_to = p_staff;
  IF NOT FOUND THEN RAISE EXCEPTION 'only the assigned operator can ask, during review' USING ERRCODE = 'check_violation'; END IF;
END $$;

-- an operator takes the case (the conflict-of-interest check of FR-OPS-06 is Unit 1's, at claim)
CREATE FUNCTION disputes.assign(p_dispute uuid, p_staff uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE disputes.disputes SET assigned_to = p_staff WHERE id = p_dispute AND status NOT IN ('decided', 'withdrawn')
     AND (assigned_to IS NULL OR assigned_to = p_staff);
  IF NOT FOUND THEN RAISE EXCEPTION 'dispute is closed or assigned to another operator' USING ERRCODE = 'check_violation'; END IF;
END $$;

-- FR-DSP-10: the buyer withdraws before a decision
CREATE FUNCTION disputes.withdraw(p_dispute uuid, p_buyer uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d disputes.disputes;
BEGIN
  SELECT * INTO d FROM disputes.disputes WHERE id = p_dispute FOR UPDATE;
  IF NOT FOUND OR p_buyer <> d.buyer_id THEN RAISE EXCEPTION 'only the buyer withdraws' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF d.status NOT IN ('open', 'under_review', 'awaiting_seller') THEN
    RAISE EXCEPTION 'a decided dispute cannot be withdrawn' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE disputes.disputes SET status = 'withdrawn', withdrawn_at = now(), info_due_at = NULL,
         last_actor = 'buyer', last_actor_id = p_buyer, last_reason = 'withdrawn by the buyer'
   WHERE id = p_dispute;
  INSERT INTO disputes.outbox (event_type, aggregate_id, payload)
  VALUES ('disputes.dispute.withdrawn', p_dispute, jsonb_build_object('orderId', d.order_id));
END $$;

-- FR-DSP-06: the assigned operator decides; the service applies the outcome through Unit 2 in the
-- same transaction (or books the return through Unit 4 for outcome (d)). Losing a dispute is a
-- seller strike (FR-TNS-04).
CREATE FUNCTION disputes.decide(p_dispute uuid, p_staff uuid, p_outcome disputes.outcome, p_reason text,
                                p_item_refund bigint DEFAULT NULL, p_fare bigint DEFAULT NULL, p_payer disputes.party DEFAULT NULL,
                                p_approval uuid DEFAULT NULL, p_strike_window interval DEFAULT '90 days', p_strike_limit integer DEFAULT 3)
RETURNS disputes.status LANGUAGE plpgsql AS $$
DECLARE d disputes.disputes; st disputes.status;
BEGIN
  SELECT * INTO d FROM disputes.disputes WHERE id = p_dispute FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such dispute' USING ERRCODE = 'check_violation'; END IF;
  IF d.assigned_to IS DISTINCT FROM p_staff THEN
    RAISE EXCEPTION 'only the assigned operator decides' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF d.status <> 'under_review' THEN RAISE EXCEPTION 'dispute is not under review' USING ERRCODE = 'check_violation'; END IF;
  st := CASE WHEN p_outcome = 'refund_after_return' THEN 'awaiting_return'::disputes.status ELSE 'decided' END;
  UPDATE disputes.disputes
     SET status = st, outcome = p_outcome, item_refund = p_item_refund, return_fare = p_fare, return_fare_payer = p_payer,
         decision_reason = p_reason, decided_by = p_staff, decided_at = now(), approval_id = p_approval,
         closed_at = CASE WHEN st = 'decided' THEN now() END,
         last_actor = 'operator', last_actor_id = p_staff, last_reason = p_reason
   WHERE id = p_dispute;
  IF p_outcome <> 'release' THEN
    PERFORM trust.record_strike(d.seller_id, 'dispute_lost', d.order_id, p_strike_window, p_strike_limit);
  END IF;
  INSERT INTO disputes.outbox (event_type, aggregate_id, payload)
  VALUES ('disputes.dispute.decided', p_dispute, jsonb_build_object('orderId', d.order_id, 'outcome', p_outcome, 'status', st));
  RETURN st;
END $$;

-- outcome (d): the item is back with the seller (courier or seller's confirmation)
CREATE FUNCTION disputes.return_completed(p_dispute uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE disputes.disputes SET status = 'decided', closed_at = now(),
         last_actor = 'system', last_actor_id = NULL, last_reason = 'item returned to the seller'
   WHERE id = p_dispute AND status = 'awaiting_return';
  IF NOT FOUND THEN RAISE EXCEPTION 'dispute is not awaiting a return' USING ERRCODE = 'check_violation'; END IF;
END $$;

-- =====================================================================
-- TRUST & SAFETY (FR-TNS, FR-REV)
-- =====================================================================
CREATE TYPE trust.report_target   AS ENUM ('listing', 'user', 'message', 'thread');
CREATE TYPE trust.report_category AS ENUM ('fraudulent', 'counterfeit', 'prohibited', 'misrepresented', 'abusive');   -- FR-TNS-01
CREATE TYPE trust.report_status   AS ENUM ('open', 'under_review', 'actioned', 'dismissed');
CREATE TYPE trust.sanction_kind   AS ENUM ('warning', 'listing_removal', 'selling_suspended', 'buying_suspended', 'account_suspended');  -- FR-TNS-03
CREATE TYPE trust.strike_reason   AS ENUM ('unilateral_cancel', 'missed_deadline', 'dispute_lost');                   -- FR-TNS-04
CREATE TYPE trust.signal_status   AS ENUM ('open', 'dismissed', 'actioned');

CREATE TABLE trust.reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   uuid NOT NULL REFERENCES identity.users(id),
  target_type   trust.report_target NOT NULL,
  target_id     uuid NOT NULL,                       -- the listing, user or thread (no FK across units, DC-5)
  message_id    bigint,                              -- for a reported message (Unit 6)
  subject_user  uuid NOT NULL REFERENCES identity.users(id),   -- whom the report is about
  category      trust.report_category NOT NULL,
  text          varchar(2000),
  status        trust.report_status NOT NULL DEFAULT 'open',
  assigned_to   uuid REFERENCES identity.staff_accounts(id),
  resolution    text,
  resolved_by   uuid REFERENCES identity.staff_accounts(id),
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_not_self CHECK (reporter_id <> subject_user),
  CONSTRAINT report_message_fields CHECK ((target_type = 'message') = (message_id IS NOT NULL)),
  CONSTRAINT report_resolved_fields CHECK ((status IN ('actioned', 'dismissed')) =
         (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(btrim(coalesce(resolution, ''))) >= 10))
);
-- one open report per reporter and target
CREATE UNIQUE INDEX reports_one_open ON trust.reports (reporter_id, target_type, target_id, coalesce(message_id, 0))
  WHERE status IN ('open', 'under_review');
CREATE INDEX reports_queue ON trust.reports (created_at) WHERE status IN ('open', 'under_review');

CREATE TABLE trust.sanctions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES identity.users(id),
  kind             trust.sanction_kind NOT NULL,
  reason           text NOT NULL CHECK (length(btrim(reason)) >= 10),
  fraud            boolean NOT NULL DEFAULT false,        -- FR-TNS-05: holds payouts
  starts_at        timestamptz NOT NULL DEFAULT now(),
  ends_at          timestamptz,                           -- NULL: until review
  automatic        boolean NOT NULL DEFAULT false,        -- CP-47 strikes
  created_by       uuid REFERENCES identity.staff_accounts(id),
  listing_id       uuid,                                  -- listing_removal (Unit 3; no FK, DC-5 permits one but the listing may be purged)
  related_type     varchar(20) CHECK (related_type IN ('report', 'dispute', 'signal', 'strikes', 'gam18')),
  related_id       uuid,
  lifted_at        timestamptz,
  lifted_by        uuid REFERENCES identity.staff_accounts(id),
  lift_reason      text,
  lift_approval_id uuid REFERENCES identity.approvals(id),
  CONSTRAINT sanction_actor CHECK (automatic OR created_by IS NOT NULL),
  CONSTRAINT sanction_period CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT sanction_warning_instant CHECK (kind NOT IN ('warning', 'listing_removal') OR ends_at IS NULL),
  CONSTRAINT sanction_listing CHECK ((kind = 'listing_removal') = (listing_id IS NOT NULL)),
  CONSTRAINT sanction_lift_fields CHECK ((lifted_at IS NULL) = (lifted_by IS NULL)
         AND (lifted_at IS NULL OR length(btrim(coalesce(lift_reason, ''))) >= 10)),
  -- CP-30: lifting an account suspension needs four-eyes approval
  CONSTRAINT sanction_account_lift_approved CHECK (kind <> 'account_suspended' OR lifted_at IS NULL OR lift_approval_id IS NOT NULL)
);
CREATE INDEX sanctions_user_live ON trust.sanctions (user_id) WHERE lifted_at IS NULL;
CREATE UNIQUE INDEX sanctions_one_auto_live ON trust.sanctions (user_id) WHERE automatic AND lifted_at IS NULL;

CREATE FUNCTION trust.sanction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.user_id, NEW.kind, NEW.reason, NEW.fraud, NEW.starts_at, NEW.automatic, NEW.created_by, NEW.listing_id)
     IS DISTINCT FROM (OLD.user_id, OLD.kind, OLD.reason, OLD.fraud, OLD.starts_at, OLD.automatic, OLD.created_by, OLD.listing_id) THEN
    RAISE EXCEPTION 'a sanction cannot be rewritten; lift it and apply a new one' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.lifted_at IS NOT NULL THEN RAISE EXCEPTION 'sanction already lifted' USING ERRCODE = 'check_violation'; END IF;
  IF NEW.ends_at IS DISTINCT FROM OLD.ends_at AND NEW.lifted_at IS NULL THEN
    RAISE EXCEPTION 'change a sanction''s end only by lifting it' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sanction_guard BEFORE UPDATE ON trust.sanctions FOR EACH ROW EXECUTE FUNCTION trust.sanction_guard();
CREATE TRIGGER sanction_no_delete BEFORE DELETE ON trust.sanctions FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- what a user may do now (SanctionPort, used by Unit 1's assertCanTransact and by Unit 2's payouts)
CREATE FUNCTION trust.restrictions(p_user uuid, OUT can_sell boolean, OUT can_buy_bid boolean, OUT fraud_hold boolean)
LANGUAGE sql STABLE AS $$
  SELECT NOT bool_or(kind IN ('selling_suspended', 'account_suspended')) IS TRUE,
         NOT bool_or(kind IN ('buying_suspended', 'account_suspended')) IS TRUE,
         bool_or(fraud) IS TRUE
    FROM trust.sanctions
   WHERE user_id = p_user AND lifted_at IS NULL AND kind NOT IN ('warning', 'listing_removal')
     AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
$$;

CREATE TABLE trust.strikes (                                                   -- FR-TNS-04
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES identity.users(id),
  reason    trust.strike_reason NOT NULL,
  order_id  uuid NOT NULL REFERENCES orders.orders(id),
  at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT strike_once UNIQUE (order_id, reason)
);
CREATE INDEX strikes_user ON trust.strikes (user_id, at);
CREATE TRIGGER strikes_append_only BEFORE UPDATE OR DELETE ON trust.strikes FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- records a strike; at CP-47 strikes within the window, suspends selling until review (once).
-- Returns true if this strike caused the suspension.
CREATE FUNCTION trust.record_strike(p_user uuid, p_reason trust.strike_reason, p_order uuid,
                                    p_window interval, p_limit integer) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n integer; inserted integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('trust.strikes:' || p_user::text, 0));
  INSERT INTO trust.strikes (user_id, reason, order_id) VALUES (p_user, p_reason, p_order) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 0 THEN RETURN false; END IF;
  SELECT count(*) INTO n FROM trust.strikes WHERE user_id = p_user AND at > now() - p_window;
  IF n >= p_limit AND NOT EXISTS (SELECT 1 FROM trust.sanctions WHERE user_id = p_user AND lifted_at IS NULL
                                   AND kind IN ('selling_suspended', 'account_suspended')) THEN
    INSERT INTO trust.sanctions (user_id, kind, reason, automatic, related_type)
    VALUES (p_user, 'selling_suspended', format('%s seller strikes within %s; pending review', n, p_window), true, 'strikes');
    INSERT INTO disputes.outbox (event_type, aggregate_id, payload)
    VALUES ('trust.sanction.applied', p_user, jsonb_build_object('kind', 'selling_suspended', 'automatic', true));
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- flagged activity queue (FR-OPS-01): signals from Units 3 to 6 and the linked-account check
CREATE TABLE trust.signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          varchar(40) NOT NULL,              -- e.g. shill_bidding, relisting, linked_accounts, chat_off_platform, delivery_issue
  source_ref    varchar(120) NOT NULL,             -- id in the source unit; dedupes repeated events
  subject_user  uuid REFERENCES identity.users(id),
  detail        jsonb NOT NULL DEFAULT '{}',
  status        trust.signal_status NOT NULL DEFAULT 'open',
  reviewed_by   uuid REFERENCES identity.staff_accounts(id),
  reviewed_at   timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signal_once UNIQUE (kind, source_ref),
  CONSTRAINT signal_review_fields CHECK ((status = 'open') = (reviewed_at IS NULL) AND (status = 'open' OR reviewed_by IS NOT NULL))
);
CREATE INDEX signals_queue ON trust.signals (created_at) WHERE status = 'open';

-- ---------------------------------------------------------------- ratings (FR-REV)
CREATE TABLE trust.rating_eligibility (               -- written when an order's escrow is terminal (Unit 2 events)
  order_id     uuid PRIMARY KEY REFERENCES orders.orders(id),
  buyer_id     uuid NOT NULL REFERENCES identity.users(id),
  seller_id    uuid NOT NULL REFERENCES identity.users(id),
  closed_at    timestamptz NOT NULL,
  rate_until   timestamptz NOT NULL,                 -- closed_at + CP-39 rating window
  completed    boolean NOT NULL,                     -- released to the seller: counts as a completed transaction
  CONSTRAINT eligibility_window CHECK (rate_until > closed_at)
);
CREATE TABLE trust.ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES trust.rating_eligibility(order_id),   -- FR-REV-02: only paid, finished orders
  rater_id    uuid NOT NULL REFERENCES identity.users(id),
  ratee_id    uuid NOT NULL REFERENCES identity.users(id),
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  text        varchar(1000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  edit_until  timestamptz NOT NULL,                  -- created + CP-39 edit period
  edited_at   timestamptz,
  reply_text  varchar(1000),                          -- FR-REV-06: one public reply by the rated user
  reply_at    timestamptz,
  removed_at  timestamptz,                            -- FR-REV-07
  removed_by  uuid REFERENCES identity.staff_accounts(id),
  removal_reason text,
  CONSTRAINT rating_once UNIQUE (order_id, rater_id),
  CONSTRAINT rating_not_self CHECK (rater_id <> ratee_id),
  CONSTRAINT rating_reply_fields CHECK ((reply_text IS NULL) = (reply_at IS NULL) AND (reply_text IS NULL OR text IS NOT NULL)),
  CONSTRAINT rating_removal_fields CHECK ((removed_at IS NULL) = (removed_by IS NULL)
         AND (removed_at IS NULL OR length(btrim(coalesce(removal_reason, ''))) >= 10))
);
CREATE INDEX ratings_ratee ON trust.ratings (ratee_id) WHERE removed_at IS NULL;

CREATE FUNCTION trust.rating_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e trust.rating_eligibility;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO e FROM trust.rating_eligibility WHERE order_id = NEW.order_id;
    IF (NEW.rater_id, NEW.ratee_id) NOT IN ((e.buyer_id, e.seller_id), (e.seller_id, e.buyer_id)) THEN
      RAISE EXCEPTION 'only the buyer and the seller of the order rate each other' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF now() > e.rate_until THEN                         -- CP-39 rating window
      RAISE EXCEPTION 'the rating window has ended (CP-39)' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reply_text IS NOT NULL OR NEW.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a new rating has no reply or removal' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.order_id, NEW.rater_id, NEW.ratee_id, NEW.created_at, NEW.edit_until) IS DISTINCT FROM (OLD.order_id, OLD.rater_id, OLD.ratee_id, OLD.created_at, OLD.edit_until) THEN
    RAISE EXCEPTION 'rating identity is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.stars, NEW.text) IS DISTINCT FROM (OLD.stars, OLD.text) THEN
    IF now() > OLD.edit_until OR OLD.removed_at IS NOT NULL THEN
      RAISE EXCEPTION 'a rating is fixed after its edit period (CP-39)' USING ERRCODE = 'check_violation';
    END IF;
    NEW.edited_at := now();
  END IF;
  IF OLD.reply_text IS NOT NULL AND (NEW.reply_text, NEW.reply_at) IS DISTINCT FROM (OLD.reply_text, OLD.reply_at) THEN
    RAISE EXCEPTION 'only one reply, which cannot be changed (FR-REV-06)' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.removed_at IS NOT NULL AND (NEW.removed_at, NEW.removed_by, NEW.removal_reason) IS DISTINCT FROM (OLD.removed_at, OLD.removed_by, OLD.removal_reason) THEN
    RAISE EXCEPTION 'a removal is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rating_guard BEFORE INSERT OR UPDATE ON trust.ratings FOR EACH ROW EXECUTE FUNCTION trust.rating_guard();

-- FR-REV-04: shown on profiles and listings; removed ratings do not count (FR-REV-07)
CREATE VIEW trust.profile_summary AS
  WITH users AS (SELECT buyer_id AS id FROM trust.rating_eligibility UNION SELECT seller_id FROM trust.rating_eligibility)
  SELECT u.id AS user_id,
         (SELECT round(avg(r.stars)::numeric, 1) FROM trust.ratings r WHERE r.ratee_id = u.id AND r.removed_at IS NULL) AS average_rating,
         (SELECT count(*) FROM trust.ratings r WHERE r.ratee_id = u.id AND r.removed_at IS NULL) AS rating_count,
         (SELECT count(*) FROM trust.rating_eligibility e WHERE e.completed AND (e.buyer_id = u.id OR e.seller_id = u.id)) AS completed_transactions
    FROM users u;

-- =====================================================================
-- STAFF TOOLS: versioned parameters and switches (FR-OPS-03, FR-OPS-08, FR-OPS-09), disclosures
-- and data exports (FR-PRV-03, FR-PRV-06)
-- =====================================================================
CREATE TABLE staff.config_versions (
  version      integer PRIMARY KEY CHECK (version >= 1),
  created_by   uuid REFERENCES identity.staff_accounts(id),      -- NULL only for the seeded version 1
  reason       text NOT NULL CHECK (length(btrim(reason)) >= 10),
  approval_id  uuid REFERENCES identity.approvals(id),            -- needed when a CP-30 control changes
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT config_version_creator CHECK (version = 1 OR created_by IS NOT NULL)
);
CREATE TABLE staff.config_values (
  version  integer NOT NULL REFERENCES staff.config_versions(version),
  code     varchar(24) NOT NULL CHECK (code ~ '^(CP-[0-9]{2}|SW-[a-z_]+)$'),
  value    jsonb NOT NULL,
  PRIMARY KEY (version, code)
);
CREATE TRIGGER config_versions_append_only BEFORE UPDATE OR DELETE ON staff.config_versions FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();
CREATE TRIGGER config_values_append_only BEFORE UPDATE OR DELETE ON staff.config_values FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

CREATE FUNCTION staff.current_config_version() RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT max(version) FROM staff.config_versions
$$;

-- FR-OPS-09: every rule of the SRS parameter table, checked on a complete candidate set.
-- Returns the list of broken rules (empty = valid).
CREATE FUNCTION staff.config_violations(c jsonb, prev jsonb) RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE v text[] := '{}';
BEGIN
  IF (c #>> '{CP-01,access}')::interval NOT BETWEEN interval '5 minutes' AND interval '30 minutes' THEN v := v || 'CP-01 must be 5-30 minutes'::text; END IF;
  IF (c #>> '{CP-02,idle}')::interval > (c #>> '{CP-02,absolute}')::interval THEN v := v || 'CP-02 idle must not exceed absolute'::text; END IF;
  IF (c #>> '{CP-03,idle}')::interval > interval '30 minutes' THEN v := v || 'CP-03 staff idle must be at most 30 minutes'::text; END IF;
  IF (c #>> '{CP-05,validity}')::interval > interval '10 minutes' THEN v := v || 'CP-05 OTP validity must be at most 10 minutes'::text; END IF;
  IF (c #>> '{CP-06,reset}')::interval > interval '60 minutes' THEN v := v || 'CP-06 reset link must be at most 60 minutes'::text; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(c -> 'CP-07') d WHERE d::interval > interval '72 hours') THEN v := v || 'CP-07 durations at most 72 hours'::text; END IF;
  IF (c #>> '{CP-08,bps}')::int <= 0 OR (c #>> '{CP-08,min_poisha}')::bigint <= 0 THEN v := v || 'CP-08 increment must be positive'::text; END IF;
  IF (c #>> '{CP-09,window}')::interval <= interval '0' OR (c #>> '{CP-09,extension}')::interval <= interval '0' THEN v := v || 'CP-09 window and extension must be positive'::text; END IF;
  IF (c #>> '{CP-10}')::interval NOT BETWEEN interval '1 hour' AND interval '72 hours' THEN v := v || 'CP-10 must be 1-72 hours'::text; END IF;
  IF (c #>> '{CP-11}')::interval NOT BETWEEN interval '1 hour' AND interval '72 hours' THEN v := v || 'CP-11 must be 1-72 hours'::text; END IF;
  IF (c #>> '{CP-12,strikes}')::int < 1 THEN v := v || 'CP-12 strikes must be at least 1'::text; END IF;
  IF (c #>> '{CP-13}')::interval NOT BETWEEN interval '5 minutes' AND interval '60 minutes' THEN v := v || 'CP-13 must be 5-60 minutes'::text; END IF;
  IF (c #>> '{CP-14}')::numeric <= 0 THEN v := v || 'CP-14 must be positive'::text; END IF;
  IF (c #>> '{CP-18}')::interval >= (c #>> '{CP-19}')::interval THEN v := v || 'CP-19 auto-release must be longer than the CP-18 dispute window'::text; END IF;
  IF (c #>> '{CP-24}')::interval < interval '3 days' THEN v := v || 'CP-24 protection period must be at least 3 days'::text; END IF;
  IF (c #>> '{CP-25,pro_bps}')::int > (c #>> '{CP-25,standard_bps}')::int THEN v := v || 'CP-25 Pro commission must not exceed standard'::text; END IF;
  IF (c #>> '{CP-26}')::int NOT BETWEEN 0 AND 5000 THEN v := v || 'CP-26 delivery margin must be 0-50%'::text; END IF;
  IF (c #>> '{CP-28,pro}')::int < (c #>> '{CP-28,standard}')::int THEN v := v || 'CP-28 Pro limit must be at least the standard limit'::text; END IF;
  IF (c #>> '{CP-29}')::interval < interval '12 hours' THEN v := v || 'CP-29 cooling-off must be at least 12 hours'::text; END IF;
  IF prev IS NOT NULL AND NOT ((c -> 'CP-30') @> (prev -> 'CP-30')) THEN v := v || 'CP-30 four-eyes list may only grow'::text; END IF;
  IF (c #>> '{CP-31}')::interval > interval '15 minutes' THEN v := v || 'CP-31 signed links at most 15 minutes'::text; END IF;
  IF (c #>> '{CP-34}')::int < 1 THEN v := v || 'CP-34 must be at least 1'::text; END IF;
  IF (c #>> '{CP-40}')::interval < interval '1 year' THEN v := v || 'CP-40 security-log retention at least 1 year'::text; END IF;
  IF (c #>> '{CP-41}')::interval > interval '30 days' THEN v := v || 'CP-41 erasure within 30 days'::text; END IF;
  IF (c #>> '{CP-45}')::int NOT BETWEEN 3 AND 10 THEN v := v || 'CP-45 must be 3-10'::text; END IF;
  IF (c #>> '{CP-46}')::interval > interval '60 minutes' THEN v := v || 'CP-46 reconciliation at most 60 minutes'::text; END IF;
  IF (c #>> '{CP-47,strikes}')::int < 1 THEN v := v || 'CP-47 must be at least 1'::text; END IF;
  RETURN v;
END $$;

CREATE FUNCTION staff.config_as_json(p_version integer) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_object_agg(code, value), '{}') FROM staff.config_values WHERE version = p_version
$$;

-- publish a new version: the previous values with the given changes; refused if any rule breaks,
-- or if a switch or a CP-30 item changes without an approval
CREATE FUNCTION staff.publish_config(p_changes jsonb, p_staff uuid, p_reason text, p_approval uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE prev integer; old jsonb; nxt jsonb; bad text[]; nv integer; k text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('staff.config', 0));
  prev := staff.current_config_version();
  old := staff.config_as_json(prev);
  FOR k IN SELECT jsonb_object_keys(p_changes) LOOP
    IF NOT old ? k THEN RAISE EXCEPTION 'unknown parameter %', k USING ERRCODE = 'check_violation'; END IF;
  END LOOP;
  nxt := old || p_changes;
  bad := staff.config_violations(nxt, old);
  IF cardinality(bad) > 0 THEN
    RAISE EXCEPTION 'parameter change refused: %', array_to_string(bad, '; ') USING ERRCODE = 'check_violation';
  END IF;
  IF p_approval IS NULL AND EXISTS (SELECT 1 FROM jsonb_object_keys(p_changes) k2
                                    WHERE (k2 LIKE 'SW-%' OR k2 = 'CP-30' OR k2 = 'CP-36') AND p_changes -> k2 IS DISTINCT FROM old -> k2) THEN
    RAISE EXCEPTION 'switches, CP-30 and CP-36 change only with four-eyes approval (SEC-IRM-04)' USING ERRCODE = 'check_violation';
  END IF;
  nv := prev + 1;
  INSERT INTO staff.config_versions (version, created_by, reason, approval_id) VALUES (nv, p_staff, p_reason, p_approval);
  INSERT INTO staff.config_values (version, code, value) SELECT nv, key, value FROM jsonb_each(nxt);
  INSERT INTO disputes.outbox (event_type, aggregate_id, payload)
  VALUES ('staff.config.published', gen_random_uuid(), jsonb_build_object('version', nv, 'changed', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_changes) x)));
  RETURN nv;
END $$;

-- FR-PRV-06: disclosure to an authority, only on a documented lawful request, with four-eyes
CREATE TABLE staff.disclosures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user      uuid NOT NULL REFERENCES identity.users(id),
  authority         varchar(200) NOT NULL,
  legal_reference   varchar(300) NOT NULL CHECK (length(btrim(legal_reference)) >= 5),   -- the request's reference
  scope             text NOT NULL CHECK (length(btrim(scope)) >= 10),
  requested_by      uuid NOT NULL REFERENCES identity.staff_accounts(id),
  approval_id       uuid REFERENCES identity.approvals(id),
  disclosed_at      timestamptz,
  user_notified_at  timestamptz,
  withheld_reason   text,                                   -- the law forbids telling the user
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disclosure_needs_approval CHECK (disclosed_at IS NULL OR approval_id IS NOT NULL),
  CONSTRAINT disclosure_notice CHECK (user_notified_at IS NULL OR withheld_reason IS NULL)
);

-- FR-PRV-03: data exports, one at a time per user
CREATE TABLE staff.export_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES identity.users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  ready_at      timestamptz,
  file_key      varchar(80),
  expires_at    timestamptz,
  CONSTRAINT export_ready_fields CHECK ((ready_at IS NULL) = (file_key IS NULL) AND (ready_at IS NULL) = (expires_at IS NULL))
);
CREATE UNIQUE INDEX export_one_pending ON staff.export_requests (user_id) WHERE ready_at IS NULL;

-- =====================================================================
-- Seed: configuration version 1 = the SRS defaults (CP-01..CP-47) and the emergency switches
-- =====================================================================
INSERT INTO staff.config_versions (version, reason) VALUES (1, 'SRS v2.0 default values (Table of configurable parameters)');
INSERT INTO staff.config_values (version, code, value) VALUES
 (1, 'CP-01', '{"access":"15 minutes"}'), (1, 'CP-02', '{"idle":"7 days","absolute":"30 days"}'),
 (1, 'CP-03', '{"idle":"15 minutes","absolute":"8 hours"}'),
 (1, 'CP-04', '{"per_account":5,"per_address":50,"window":"15 minutes"}'),
 (1, 'CP-05', '{"validity":"5 minutes","attempts":5,"sends_per_hour":3,"sends_per_day":10}'),
 (1, 'CP-06', '{"reset":"30 minutes","verify":"24 hours"}'),
 (1, 'CP-07', '["1 hour","2 hours","6 hours","24 hours","72 hours"]'),
 (1, 'CP-08', '{"bps":200,"min_poisha":5000}'), (1, 'CP-09', '{"window":"2 minutes","extension":"2 minutes"}'),
 (1, 'CP-10', '"24 hours"'), (1, 'CP-11', '"24 hours"'), (1, 'CP-12', '{"strikes":2,"window":"90 days","suspension":"30 days"}'),
 (1, 'CP-13', '"15 minutes"'), (1, 'CP-14', '2'), (1, 'CP-15', '"7 days"'), (1, 'CP-16', '"3 days"'), (1, 'CP-17', '"7 days"'),
 (1, 'CP-18', '"3 days"'), (1, 'CP-19', '"5 days"'), (1, 'CP-20', '"48 hours"'), (1, 'CP-21', '"5 days"'),
 (1, 'CP-22', '"24 hours"'), (1, 'CP-23', '"24 hours"'), (1, 'CP-24', '"7 days"'),
 (1, 'CP-25', '{"standard_bps":500,"pro_bps":300}'), (1, 'CP-26', '1000'),
 (1, 'CP-27', '{"new_days":30,"new_per_order":5000000,"new_open":10000000,"per_order":20000000}'),
 (1, 'CP-28', '{"standard":10,"pro":50}'), (1, 'CP-29', '"24 hours"'),
 (1, 'CP-30', '["kyc.revoke","blacklist.add","blacklist.remove","dispute.outcome_20000","account.reinstate","staff.mfa_reset","emergency.control"]'),
 (1, 'CP-31', '"5 minutes"'), (1, 'CP-32', '{"tolerance":"5 minutes","retention":"30 days"}'),
 (1, 'CP-33', '{"image_bytes":10485760,"photos":10,"evidence":10}'), (1, 'CP-34', '3'),
 (1, 'CP-35', '{"bids_per_min":10,"chat_per_min":30,"listings_per_day":10,"reports_per_day":20,"search_per_min":60}'),
 (1, 'CP-36', 'true'), (1, 'CP-37', '{"periods":["24 hours","48 hours"],"fee_poisha":null}'),
 (1, 'CP-38', '{"auction_end":"5 minutes","reminders":["24 hours","2 hours"]}'),
 (1, 'CP-39', '{"window":"14 days","edit":"48 hours"}'), (1, 'CP-40', '"1 year"'), (1, 'CP-41', '"30 days"'),
 (1, 'CP-42', '{"critical":"7 days","high":"30 days"}'), (1, 'CP-43', '"see delivery.fare_tables"'), (1, 'CP-44', '"48 hours"'),
 (1, 'CP-45', '5'), (1, 'CP-46', '"15 minutes"'), (1, 'CP-47', '{"strikes":3,"window":"90 days"}'),
 (1, 'SW-new_orders', 'true'), (1, 'SW-payouts', 'true');

-- =====================================================================
-- Grants (SEC-INF-03)
-- =====================================================================
GRANT USAGE ON SCHEMA disputes, trust, staff TO tb_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA disputes, trust, staff TO tb_app;
REVOKE UPDATE ON disputes.history, disputes.statements, disputes.evidence, trust.strikes,
                 staff.config_versions, staff.config_values FROM tb_app;
GRANT SELECT ON trust.profile_summary TO tb_app;
`;
