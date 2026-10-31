import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 5: a frozen copy of docs/design/sql/05_game_accounts.sql as of this migration (I-60, NFR-MNT-04).
// Never edit an applied migration: a later change to the design file comes as a new migration.
// Runs as tb_owner (SEC-INF-03). down() drops the schemas game_accounts; extensions and roles stay.
export class GameAccounts1793491200005 implements MigrationInterface {
  name = 'GameAccounts1793491200005';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP SCHEMA IF EXISTS game_accounts CASCADE');
  }
}

const SQL = String.raw`-- =====================================================================
-- TrustBazaar - Unit 5: Game-Account Escrow - PostgreSQL 15 schema
-- Design document: docs/design/05_game_accounts.pdf
-- Requirements: SRS v2.0 FR-GAM-01..20; FR-PAY-07/08 (game side); FR-DSP-01 and FR-DSP-05
--   (game windows and evidence); SEC-GAM-01..03, SEC-DAT-07, SEC-DAT-10; IF-UI-06, IF-SW-07; DR-07.
-- Depends on: 01_identity_access.sql (identity.users, identity.staff_accounts, identity.sessions,
--   identity.forbid_change), 02_orders_payments.sql (orders.orders), 03_listings_auctions.sql
--   (listings.listings). Unit 4 is not used: game accounts have no delivery (FR-GAM-06).
-- Conventions DC-1..DC-14. No function here reads another unit's tables (DC-1); order and
-- listing facts arrive as arguments. The server never holds anything that can decrypt the
-- credentials (SEC-GAM-01): it stores the buyer's public key and the sealed ciphertext only.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS game_accounts;

-- ---------------------------------------------------------------- types
CREATE TYPE game_accounts.proof_status    AS ENUM ('issued', 'submitted', 'approved', 'rejected', 'expired');
CREATE TYPE game_accounts.live_check      AS ENUM ('matched', 'not_matched', 'not_available');
CREATE TYPE game_accounts.handover_status AS ENUM
  ('preparing',             -- before payment: disclosure acknowledged, buyer key registered
   'awaiting_credentials',  -- paid; the seller must seal the credentials by CP-22
   'delivered',             -- sealed credentials delivered; takeover window CP-23 running
   'rekey_requested',       -- the buyer lost the key; waiting for the seller to seal again (FR-GAM-12)
   'disputed',              -- credentials_invalid reported; decided in Unit 7
   'taken_over',            -- takeover complete: the delivery event (FR-GAM-15); protection period runs
   'cancelled',             -- refunded before the delivery event
   'closed');               -- escrow terminal after delivery; ciphertext deleted (FR-GAM-19)
CREATE TYPE game_accounts.takeover_step   AS ENUM
  ('password', 'recovery_email', 'recovery_phone', 'social_logins', 'two_step');   -- FR-GAM-13
CREATE TYPE game_accounts.takeover_source AS ENUM ('checklist', 'window_end');

-- =====================================================================
-- Games and listing details (FR-GAM-02). A listing's title, description and price are Unit 3's;
-- this unit adds the structured game fields. No login detail is ever part of a listing.
-- =====================================================================
CREATE TABLE game_accounts.games (
  id                smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              varchar(40) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name              varchar(80) NOT NULL,
  platforms         text[] NOT NULL CHECK (cardinality(platforms) >= 1),
  code_placement    varchar(200) NOT NULL,      -- where the ownership code goes, e.g. "profile bio"
  publisher_note    varchar(500) NOT NULL,      -- the publisher's stance on transfers, for the disclosure
  active            boolean NOT NULL DEFAULT true
);

CREATE TABLE game_accounts.details (
  listing_id      uuid PRIMARY KEY REFERENCES listings.listings(id),
  seller_id       uuid NOT NULL REFERENCES identity.users(id),
  game_id         smallint NOT NULL REFERENCES game_accounts.games(id),
  platform        varchar(30) NOT NULL,
  player_id       varchar(64) NOT NULL CHECK (player_id ~ '^[[:print:]]+$' AND length(btrim(player_id)) >= 2),
  player_id_norm  varchar(64) GENERATED ALWAYS AS (lower(regexp_replace(player_id, '\s', '', 'g'))) STORED,
  contents        varchar(2000) NOT NULL CHECK (length(btrim(contents)) >= 10),   -- level, items, linked purchases
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX details_player ON game_accounts.details (game_id, player_id_norm);

CREATE FUNCTION game_accounts.details_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM game_accounts.games g WHERE g.id = NEW.game_id AND NEW.platform::text = ANY (g.platforms)) THEN
    RAISE EXCEPTION 'platform % is not offered for this game', NEW.platform USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.game_id, NEW.player_id, NEW.seller_id) IS DISTINCT FROM (OLD.game_id, OLD.player_id, OLD.seller_id)
     AND EXISTS (SELECT 1 FROM game_accounts.ownership_proofs WHERE listing_id = OLD.listing_id AND status IN ('submitted', 'approved')) THEN
    RAISE EXCEPTION 'game and player ID are fixed once ownership proof is submitted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- =====================================================================
-- Ownership proof (FR-GAM-03). The code is not secret: it is placed publicly in the game profile.
-- What it proves is freshness and control. The screenshot is Confidential and stored encrypted
-- like KYC files (Unit 1 FileVault envelope: per-file key wrapped by the KEK).
-- =====================================================================
CREATE TABLE game_accounts.ownership_proofs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid NOT NULL REFERENCES game_accounts.details(listing_id),
  code               varchar(12) NOT NULL UNIQUE CHECK (code ~ '^TB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$'),
  status             game_accounts.proof_status NOT NULL DEFAULT 'issued',
  issued_at          timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  screenshot_key     varchar(80) UNIQUE,                 -- random name on the evidence volume
  screenshot_dek     bytea,                              -- wrapped data key; NULL once erased
  screenshot_sha256  bytea CHECK (octet_length(screenshot_sha256) = 32),
  submitted_at       timestamptz,
  reviewed_by        uuid REFERENCES identity.staff_accounts(id),
  reviewed_at        timestamptz,
  live_check         game_accounts.live_check,
  review_reason      text,
  CONSTRAINT proof_expiry CHECK (expires_at > issued_at),
  CONSTRAINT proof_submitted_fields CHECK ((status IN ('submitted', 'approved', 'rejected'))
         = (submitted_at IS NOT NULL AND screenshot_key IS NOT NULL AND screenshot_sha256 IS NOT NULL) OR status = 'expired'),
  CONSTRAINT proof_review_fields CHECK ((status IN ('approved', 'rejected'))
         = (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND live_check IS NOT NULL)),
  CONSTRAINT proof_reject_reason CHECK (status <> 'rejected' OR length(btrim(coalesce(review_reason, ''))) >= 10),
  CONSTRAINT proof_approve_live CHECK (status <> 'approved' OR live_check <> 'not_matched')
);
CREATE UNIQUE INDEX proof_one_open ON game_accounts.ownership_proofs (listing_id) WHERE status IN ('issued', 'submitted');
CREATE INDEX proofs_queue ON game_accounts.ownership_proofs (submitted_at) WHERE status = 'submitted';

CREATE TRIGGER details_guard BEFORE INSERT OR UPDATE ON game_accounts.details
  FOR EACH ROW EXECUTE FUNCTION game_accounts.details_guard();

CREATE FUNCTION game_accounts.proof_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'issued' THEN RAISE EXCEPTION 'a proof starts as issued' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF (NEW.listing_id, NEW.code, NEW.issued_at, NEW.expires_at) IS DISTINCT FROM (OLD.listing_id, OLD.code, OLD.issued_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'proof code and validity are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('issued'::game_accounts.proof_status, 'submitted'::game_accounts.proof_status), ('issued', 'expired'),
       ('submitted', 'approved'), ('submitted', 'rejected'))) THEN
    RAISE EXCEPTION 'proof % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('approved', 'rejected') AND (NEW.reviewed_by, NEW.reviewed_at, NEW.live_check, NEW.review_reason, NEW.screenshot_key, NEW.screenshot_sha256)
       IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.live_check, OLD.review_reason, OLD.screenshot_key, OLD.screenshot_sha256) THEN
    RAISE EXCEPTION 'a reviewed proof is final' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER proof_guard BEFORE INSERT OR UPDATE ON game_accounts.ownership_proofs
  FOR EACH ROW EXECUTE FUNCTION game_accounts.proof_guard();

-- =====================================================================
-- Player-ID claims (FR-GAM-04). Taken when ownership is approved, not when a draft is written,
-- so nobody can block a player ID by drafting it. Held while the listing is live and, after a
-- sale, until the order's escrow is terminal (takeover window and protection period included).
-- =====================================================================
CREATE TABLE game_accounts.claims (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id          smallint NOT NULL REFERENCES game_accounts.games(id),
  player_id_norm   varchar(64) NOT NULL,
  listing_id       uuid NOT NULL REFERENCES game_accounts.details(listing_id),
  claimed_at       timestamptz NOT NULL DEFAULT now(),
  order_id         uuid REFERENCES orders.orders(id),          -- set when sold
  released_at      timestamptz,
  release_reason   varchar(40) CHECK (release_reason IN ('listing_ended', 'escrow_terminal', 'operator')),
  CONSTRAINT claim_release_fields CHECK ((released_at IS NULL) = (release_reason IS NULL))
);
CREATE UNIQUE INDEX claims_one_live ON game_accounts.claims (game_id, player_id_norm) WHERE released_at IS NULL;

-- =====================================================================
-- Handover per order (FR-GAM-05 to FR-GAM-17)
-- =====================================================================
CREATE TABLE game_accounts.handovers (
  order_id             uuid PRIMARY KEY REFERENCES orders.orders(id),
  listing_id           uuid NOT NULL REFERENCES game_accounts.details(listing_id),
  buyer_id             uuid NOT NULL REFERENCES identity.users(id),
  seller_id            uuid NOT NULL REFERENCES identity.users(id),
  status               game_accounts.handover_status NOT NULL DEFAULT 'preparing',
  disclosure_version   smallint NOT NULL CHECK (disclosure_version >= 1),       -- FR-GAM-05
  disclosure_ack_at    timestamptz NOT NULL DEFAULT now(),
  key_version          smallint NOT NULL DEFAULT 0 CHECK (key_version BETWEEN 0 AND 2),
  rekeys_used          smallint NOT NULL DEFAULT 0 CHECK (rekeys_used BETWEEN 0 AND 1),   -- FR-GAM-12: one re-key
  credentials_due_at   timestamptz,                    -- CP-22 (the order's fulfilment deadline)
  first_delivered_at   timestamptz,
  delivered_at         timestamptz,                    -- latest delivery (restarts the window, FR-GAM-12)
  takeover_due_at      timestamptz,                    -- delivered_at + CP-23
  rekey_requested_at   timestamptz,
  rekey_due_at         timestamptz,                    -- DV-37
  pw_changed_at        timestamptz,
  recovery_email_at    timestamptz,
  recovery_phone_at    timestamptz,
  social_logins_at     timestamptz,
  two_step_at          timestamptz,
  taken_over_at        timestamptz,
  takeover_source      game_accounts.takeover_source,
  disputed_at          timestamptz,
  cancelled_at         timestamptz,
  closed_at            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handover_parties CHECK (buyer_id <> seller_id),
  CONSTRAINT key_version_counts_rekeys CHECK (key_version = 0 OR key_version = rekeys_used + 1),
  CONSTRAINT paid_has_deadline CHECK (status IN ('preparing', 'cancelled') OR credentials_due_at IS NOT NULL),
  CONSTRAINT paid_needs_key CHECK (status IN ('preparing', 'cancelled') OR key_version >= 1),
  CONSTRAINT delivered_fields CHECK ((status = 'delivered') <= (delivered_at IS NOT NULL AND takeover_due_at IS NOT NULL)),
  CONSTRAINT rekey_fields CHECK ((status = 'rekey_requested') = (rekey_due_at IS NOT NULL)),
  CONSTRAINT takeover_fields CHECK ((taken_over_at IS NULL) = (takeover_source IS NULL)
         AND (status <> 'taken_over' OR taken_over_at IS NOT NULL)),
  CONSTRAINT checklist_complete CHECK (takeover_source IS DISTINCT FROM 'checklist' OR
         (pw_changed_at IS NOT NULL AND recovery_email_at IS NOT NULL AND recovery_phone_at IS NOT NULL
          AND social_logins_at IS NOT NULL AND two_step_at IS NOT NULL)),
  CONSTRAINT cancelled_fields CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CONSTRAINT closed_fields CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT cancel_only_before_takeover CHECK (status <> 'cancelled' OR taken_over_at IS NULL)
);
CREATE INDEX handovers_takeover_due ON game_accounts.handovers (takeover_due_at) WHERE status = 'delivered';
CREATE INDEX handovers_rekey_due ON game_accounts.handovers (rekey_due_at) WHERE status = 'rekey_requested';

CREATE FUNCTION game_accounts.handover_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'preparing' OR NEW.key_version <> 0 THEN
      RAISE EXCEPTION 'a handover starts as preparing, without a key' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.order_id, NEW.listing_id, NEW.buyer_id, NEW.seller_id, NEW.disclosure_version, NEW.disclosure_ack_at)
     IS DISTINCT FROM (OLD.order_id, OLD.listing_id, OLD.buyer_id, OLD.seller_id, OLD.disclosure_version, OLD.disclosure_ack_at) THEN
    RAISE EXCEPTION 'handover parties and disclosure are fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status IN ('cancelled', 'closed') THEN
    RAISE EXCEPTION 'handover is closed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('preparing'::game_accounts.handover_status, 'awaiting_credentials'::game_accounts.handover_status), ('preparing', 'cancelled'),
       ('awaiting_credentials', 'delivered'), ('awaiting_credentials', 'cancelled'),
       ('delivered', 'taken_over'), ('delivered', 'disputed'), ('delivered', 'rekey_requested'), ('delivered', 'cancelled'),
       ('rekey_requested', 'delivered'), ('rekey_requested', 'disputed'), ('rekey_requested', 'cancelled'),
       ('disputed', 'delivered'), ('disputed', 'closed'),
       ('taken_over', 'closed'))) THEN
    RAISE EXCEPTION 'handover % -> % is not permitted', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- a confirmed checklist step is never undone; the takeover moment is never moved
  IF (OLD.pw_changed_at IS NOT NULL AND NEW.pw_changed_at IS DISTINCT FROM OLD.pw_changed_at)
     OR (OLD.recovery_email_at IS NOT NULL AND NEW.recovery_email_at IS DISTINCT FROM OLD.recovery_email_at)
     OR (OLD.recovery_phone_at IS NOT NULL AND NEW.recovery_phone_at IS DISTINCT FROM OLD.recovery_phone_at)
     OR (OLD.social_logins_at IS NOT NULL AND NEW.social_logins_at IS DISTINCT FROM OLD.social_logins_at)
     OR (OLD.two_step_at IS NOT NULL AND NEW.two_step_at IS DISTINCT FROM OLD.two_step_at)
     OR (OLD.taken_over_at IS NOT NULL AND NEW.taken_over_at IS DISTINCT FROM OLD.taken_over_at)
     OR (OLD.first_delivered_at IS NOT NULL AND NEW.first_delivered_at IS DISTINCT FROM OLD.first_delivered_at) THEN
    RAISE EXCEPTION 'takeover confirmations and the takeover time are fixed once recorded' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.rekeys_used < OLD.rekeys_used OR NEW.key_version < OLD.key_version THEN
    RAISE EXCEPTION 'key versions only increase' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER handover_guard BEFORE INSERT OR UPDATE ON game_accounts.handovers
  FOR EACH ROW EXECUTE FUNCTION game_accounts.handover_guard();

-- the buyer's public keys (FR-GAM-07): raw uncompressed P-256 points (65 bytes, 0x04 prefix).
-- The private key never leaves the buyer's browser, where it is non-extractable.
CREATE TABLE game_accounts.buyer_keys (
  order_id     uuid NOT NULL REFERENCES game_accounts.handovers(order_id),
  version      smallint NOT NULL CHECK (version BETWEEN 1 AND 2),
  public_key   bytea NOT NULL CHECK (octet_length(public_key) = 65 AND get_byte(public_key, 0) = 4),
  session_id   uuid NOT NULL REFERENCES identity.sessions(id),       -- the browser session that registered it
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, version)
);
CREATE TRIGGER buyer_keys_append_only BEFORE UPDATE OR DELETE ON game_accounts.buyer_keys
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- the sealed credentials (FR-GAM-09): HPKE base mode, DHKEM(P-256, HKDF-SHA256), HKDF-SHA256,
-- AES-256-GCM (DV-35). enc = the sender's encapsulated key (65 bytes). The plaintext is padded
-- to a multiple of 512 bytes before sealing (DV-34), so ciphertext = 512 k + 16-byte tag.
CREATE TABLE game_accounts.sealed_credentials (
  order_id      uuid NOT NULL,
  key_version   smallint NOT NULL,
  enc           bytea CHECK (octet_length(enc) = 65 AND get_byte(enc, 0) = 4),
  ciphertext    bytea CHECK (octet_length(ciphertext) BETWEEN 528 AND 4112 AND (octet_length(ciphertext) - 16) % 512 = 0),
  delivered_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  PRIMARY KEY (order_id, key_version),
  FOREIGN KEY (order_id, key_version) REFERENCES game_accounts.buyer_keys(order_id, version),
  CONSTRAINT sealed_deleted CHECK ((deleted_at IS NULL) = (enc IS NOT NULL AND ciphertext IS NOT NULL))
);

CREATE FUNCTION game_accounts.sealed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deleted_at IS NULL OR OLD.deleted_at IS NOT NULL
     OR (NEW.order_id, NEW.key_version, NEW.delivered_at) IS DISTINCT FROM (OLD.order_id, OLD.key_version, OLD.delivered_at) THEN
    RAISE EXCEPTION 'sealed credentials can only be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sealed_guard BEFORE UPDATE ON game_accounts.sealed_credentials
  FOR EACH ROW EXECUTE FUNCTION game_accounts.sealed_guard();

-- credential-access log (FR-GAM-11, SEC-GAM-02): append-only
CREATE TABLE game_accounts.access_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES game_accounts.handovers(order_id),
  user_id      uuid NOT NULL REFERENCES identity.users(id),
  session_id   uuid NOT NULL REFERENCES identity.sessions(id),
  key_version  smallint NOT NULL,
  source_ip    inet,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_log_order ON game_accounts.access_log (order_id, id);
CREATE TRIGGER access_log_append_only BEFORE UPDATE OR DELETE ON game_accounts.access_log
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- takeover confirmations (DR-07): append-only, one per step
CREATE TABLE game_accounts.confirmations (
  order_id     uuid NOT NULL REFERENCES game_accounts.handovers(order_id),
  step         game_accounts.takeover_step NOT NULL,
  session_id   uuid NOT NULL REFERENCES identity.sessions(id),
  at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, step)
);
CREATE TRIGGER confirmations_append_only BEFORE UPDATE OR DELETE ON game_accounts.confirmations
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

CREATE TABLE game_accounts.outbox (                                            -- DC-6
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type      varchar(80) NOT NULL CHECK (event_type ~ '^game_accounts\.[a-z_]+\.[a-z_]+$'),
  aggregate_id    uuid NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  attempts        smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at   timestamptz
);
CREATE INDEX game_outbox_pending ON game_accounts.outbox (next_attempt_at) WHERE dispatched_at IS NULL;

-- =====================================================================
-- Reference functions
-- =====================================================================
-- FR-GAM-08: fingerprint of a public key: the first 80 bits of SHA-256 over the raw key, as five
-- groups of four hex digits (DV-36). Browsers compute it themselves; this is the reference and
-- the test vector. A fingerprint shown by the server proves nothing, so the API never sends one.
CREATE FUNCTION game_accounts.fingerprint(p_key bytea) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT array_to_string(ARRAY(SELECT substr(h, i, 4) FROM generate_series(1, 17, 4) i), '-')
    FROM (SELECT encode(sha256(p_key), 'hex') AS h) x
$$;

-- =====================================================================
-- Operations. Each locks the handover row; the service has already locked the order through
-- OrdersPort.lockForFulfilment (DC-14), and calls EscrowCommands afterwards.
-- =====================================================================

-- FR-GAM-03: review an ownership proof; approval takes the player-ID claim (FR-GAM-04)
CREATE FUNCTION game_accounts.review_proof(p_proof uuid, p_staff uuid, p_approve boolean,
                                           p_live game_accounts.live_check, p_reason text)
RETURNS game_accounts.proof_status LANGUAGE plpgsql AS $$
DECLARE p game_accounts.ownership_proofs; d game_accounts.details;
BEGIN
  SELECT * INTO p FROM game_accounts.ownership_proofs WHERE id = p_proof FOR UPDATE;
  IF NOT FOUND OR p.status <> 'submitted' THEN
    RAISE EXCEPTION 'proof is not awaiting review' USING ERRCODE = 'check_violation';
  END IF;
  IF p_approve AND now() >= p.expires_at THEN
    RAISE EXCEPTION 'ownership code has expired; the seller must request a new one' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO d FROM game_accounts.details WHERE listing_id = p.listing_id;
  UPDATE game_accounts.ownership_proofs
     SET status = CASE WHEN p_approve THEN 'approved'::game_accounts.proof_status ELSE 'rejected' END,
         reviewed_by = p_staff, reviewed_at = now(), live_check = p_live, review_reason = p_reason
   WHERE id = p_proof;
  IF p_approve THEN
    BEGIN
      INSERT INTO game_accounts.claims (game_id, player_id_norm, listing_id)
      VALUES (d.game_id, d.player_id_norm, d.listing_id);
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'this player ID is already listed, or its last sale is still protected' USING ERRCODE = 'check_violation';
    END;
  END IF;
  INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload)
  VALUES (CASE WHEN p_approve THEN 'game_accounts.ownership.approved' ELSE 'game_accounts.ownership.rejected' END,
          p.listing_id, jsonb_build_object('proofId', p_proof, 'reason', p_reason));
  RETURN CASE WHEN p_approve THEN 'approved'::game_accounts.proof_status ELSE 'rejected' END;
END $$;

-- FR-GAM-05, FR-GAM-07: register (or replace, before payment) the buyer's public key
CREATE FUNCTION game_accounts.register_key(p_order uuid, p_buyer uuid, p_key bytea, p_session uuid)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE h game_accounts.handovers;
BEGIN
  SELECT * INTO h FROM game_accounts.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'acknowledge the disclosure first' USING ERRCODE = 'check_violation'; END IF;
  IF p_buyer <> h.buyer_id THEN RAISE EXCEPTION 'only the buyer registers a key' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF h.status <> 'preparing' OR h.key_version <> 0 THEN
    RAISE EXCEPTION 'the key is fixed at checkout; after payment use a re-key' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO game_accounts.buyer_keys (order_id, version, public_key, session_id) VALUES (p_order, 1, p_key, p_session);
  UPDATE game_accounts.handovers SET key_version = 1 WHERE order_id = p_order;
  RETURN 1;
END $$;

-- Unit 2's GameAccountPort.assertCheckoutReady (FR-GAM-05, FR-GAM-07)
CREATE FUNCTION game_accounts.checkout_ready(p_order uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM game_accounts.handovers WHERE order_id = p_order AND status = 'preparing' AND key_version = 1)
$$;

-- order paid: the seller is asked for the credentials (FR-GAM-10)
CREATE FUNCTION game_accounts.mark_paid(p_order uuid, p_due timestamptz) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE game_accounts.handovers SET status = 'awaiting_credentials', credentials_due_at = p_due
   WHERE order_id = p_order AND status = 'preparing';
  IF NOT FOUND THEN RAISE EXCEPTION 'handover is not ready for payment' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload)
  VALUES ('game_accounts.credentials.requested', p_order, jsonb_build_object('dueAt', p_due));
END $$;

-- FR-GAM-09, FR-GAM-10, FR-GAM-12, FR-GAM-13: the seller delivers sealed credentials for the
-- buyer's current key. Returns true on the first delivery (the fulfilment step for Unit 2).
CREATE FUNCTION game_accounts.deliver(p_order uuid, p_seller uuid, p_key_version smallint,
                                      p_enc bytea, p_ciphertext bytea, p_window interval)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE h game_accounts.handovers;
BEGIN
  IF p_window <= interval '0' THEN RAISE EXCEPTION 'CP-23 must be positive' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO h FROM game_accounts.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no handover for this order' USING ERRCODE = 'check_violation'; END IF;
  IF p_seller <> h.seller_id THEN RAISE EXCEPTION 'only the seller delivers credentials' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF h.status NOT IN ('awaiting_credentials', 'rekey_requested') THEN
    RAISE EXCEPTION 'credentials are not expected now (%)', h.status USING ERRCODE = 'check_violation';
  END IF;
  IF h.status = 'awaiting_credentials' AND now() >= h.credentials_due_at THEN
    RAISE EXCEPTION 'the credential delivery deadline has passed' USING ERRCODE = 'check_violation';
  END IF;
  IF h.status = 'rekey_requested' AND now() >= h.rekey_due_at THEN
    RAISE EXCEPTION 'the re-delivery deadline has passed' USING ERRCODE = 'check_violation';
  END IF;
  IF p_key_version <> h.key_version THEN
    RAISE EXCEPTION 'sealed for key version %, but the buyer''s current key is version %', p_key_version, h.key_version
      USING ERRCODE = 'check_violation';
  END IF;
  -- older ciphertexts are useless to the buyer and are deleted at once
  UPDATE game_accounts.sealed_credentials SET enc = NULL, ciphertext = NULL, deleted_at = now()
   WHERE order_id = p_order AND deleted_at IS NULL;
  INSERT INTO game_accounts.sealed_credentials (order_id, key_version, enc, ciphertext)
  VALUES (p_order, p_key_version, p_enc, p_ciphertext);
  UPDATE game_accounts.handovers
     SET status = 'delivered', first_delivered_at = coalesce(first_delivered_at, now()),
         delivered_at = now(), takeover_due_at = now() + p_window, rekey_due_at = NULL
   WHERE order_id = p_order;
  INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload)
  VALUES ('game_accounts.credentials.delivered', p_order,
          jsonb_build_object('keyVersion', p_key_version, 'takeoverDueAt', now() + p_window));
  RETURN h.first_delivered_at IS NULL;
END $$;

-- FR-GAM-11: the buyer retrieves the ciphertext; every retrieval is logged
CREATE FUNCTION game_accounts.fetch_sealed(p_order uuid, p_user uuid, p_session uuid, p_ip inet)
RETURNS TABLE (key_version smallint, enc bytea, ciphertext bytea) LANGUAGE plpgsql AS $$
DECLARE h game_accounts.handovers;
BEGIN
  SELECT * INTO h FROM game_accounts.handovers WHERE order_id = p_order FOR SHARE;
  IF NOT FOUND OR p_user <> h.buyer_id THEN
    RAISE EXCEPTION 'only the buyer of this order can retrieve the credentials' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM game_accounts.sealed_credentials s WHERE s.order_id = p_order AND s.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'no credentials are available' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO game_accounts.access_log (order_id, user_id, session_id, key_version, source_ip)
  SELECT p_order, p_user, p_session, s.key_version, p_ip FROM game_accounts.sealed_credentials s
   WHERE s.order_id = p_order AND s.deleted_at IS NULL;
  RETURN QUERY SELECT s.key_version, s.enc, s.ciphertext FROM game_accounts.sealed_credentials s
                WHERE s.order_id = p_order AND s.deleted_at IS NULL;
END $$;

-- FR-GAM-13, FR-GAM-15: the buyer confirms a checklist step. Returns true when this completes the
-- takeover (all five steps): the delivery event for Unit 2.
CREATE FUNCTION game_accounts.confirm_step(p_order uuid, p_buyer uuid, p_step game_accounts.takeover_step, p_session uuid)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE h game_accounts.handovers;
BEGIN
  SELECT * INTO h FROM game_accounts.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR p_buyer <> h.buyer_id THEN
    RAISE EXCEPTION 'only the buyer confirms the takeover' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF h.status <> 'delivered' THEN RAISE EXCEPTION 'takeover is not in progress (%)', h.status USING ERRCODE = 'check_violation'; END IF;
  IF now() >= h.takeover_due_at THEN RAISE EXCEPTION 'the takeover window has ended' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO game_accounts.confirmations (order_id, step, session_id) VALUES (p_order, p_step, p_session)
  ON CONFLICT DO NOTHING;
  UPDATE game_accounts.handovers SET
      pw_changed_at     = CASE WHEN p_step = 'password'       THEN coalesce(pw_changed_at, now())     ELSE pw_changed_at END,
      recovery_email_at = CASE WHEN p_step = 'recovery_email' THEN coalesce(recovery_email_at, now()) ELSE recovery_email_at END,
      recovery_phone_at = CASE WHEN p_step = 'recovery_phone' THEN coalesce(recovery_phone_at, now()) ELSE recovery_phone_at END,
      social_logins_at  = CASE WHEN p_step = 'social_logins'  THEN coalesce(social_logins_at, now())  ELSE social_logins_at END,
      two_step_at       = CASE WHEN p_step = 'two_step'       THEN coalesce(two_step_at, now())       ELSE two_step_at END
   WHERE order_id = p_order RETURNING * INTO h;
  IF h.pw_changed_at IS NOT NULL AND h.recovery_email_at IS NOT NULL AND h.recovery_phone_at IS NOT NULL
     AND h.social_logins_at IS NOT NULL AND h.two_step_at IS NOT NULL THEN
    UPDATE game_accounts.handovers SET status = 'taken_over', taken_over_at = now(), takeover_source = 'checklist'
     WHERE order_id = p_order;
    INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload)
    VALUES ('game_accounts.takeover.completed', p_order, jsonb_build_object('source', 'checklist', 'at', now()));
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- FR-GAM-15: the window-end job. Uses the statement clock, so that a job transaction started
-- just before the deadline still sees it pass. Completion time is the end of the window.
CREATE FUNCTION game_accounts.complete_if_due(p_order uuid) RETURNS timestamptz LANGUAGE plpgsql AS $$
DECLARE h game_accounts.handovers;
BEGIN
  SELECT * INTO h FROM game_accounts.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR h.status <> 'delivered' OR clock_timestamp() < h.takeover_due_at THEN RETURN NULL; END IF;
  UPDATE game_accounts.handovers SET status = 'taken_over', taken_over_at = h.takeover_due_at, takeover_source = 'window_end'
   WHERE order_id = p_order;
  INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload)
  VALUES ('game_accounts.takeover.completed', p_order, jsonb_build_object('source', 'window_end', 'at', h.takeover_due_at));
  RETURN h.takeover_due_at;
END $$;

-- FR-GAM-14: "the credentials do not work", accepted only inside the window and only until the
-- buyer has confirmed changing the recovery e-mail. The service opens the dispute in the same
-- transaction (Unit 7).
CREATE FUNCTION game_accounts.report_invalid(p_order uuid, p_buyer uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h game_accounts.handovers;
BEGIN
  SELECT * INTO h FROM game_accounts.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR p_buyer <> h.buyer_id THEN
    RAISE EXCEPTION 'only the buyer can report' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF h.recovery_email_at IS NOT NULL THEN
    RAISE EXCEPTION 'the recovery e-mail was confirmed as changed; credentials_invalid is no longer accepted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF h.status <> 'delivered' OR now() >= h.takeover_due_at THEN
    RAISE EXCEPTION 'a credentials_invalid report is accepted only during the takeover window' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE game_accounts.handovers SET status = 'disputed', disputed_at = now() WHERE order_id = p_order;
  INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload)
  VALUES ('game_accounts.credentials.reported_invalid', p_order, '{}');
END $$;

-- FR-GAM-12: one re-key during the window, before the recovery e-mail step; the window stops
-- until the seller seals again (re-delivery deadline DV-37).
CREATE FUNCTION game_accounts.request_rekey(p_order uuid, p_buyer uuid, p_key bytea, p_session uuid, p_redeliver interval)
RETURNS smallint LANGUAGE plpgsql AS $$
DECLARE h game_accounts.handovers;
BEGIN
  SELECT * INTO h FROM game_accounts.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR p_buyer <> h.buyer_id THEN
    RAISE EXCEPTION 'only the buyer can re-key' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF h.rekeys_used >= 1 THEN RAISE EXCEPTION 'the one re-key has been used' USING ERRCODE = 'check_violation'; END IF;
  IF h.recovery_email_at IS NOT NULL THEN
    RAISE EXCEPTION 'the buyer already controls the recovery e-mail; no re-key is needed' USING ERRCODE = 'check_violation';
  END IF;
  IF h.status <> 'delivered' OR now() >= h.takeover_due_at THEN
    RAISE EXCEPTION 'a re-key is possible only during the takeover window' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO game_accounts.buyer_keys (order_id, version, public_key, session_id) VALUES (p_order, h.key_version + 1, p_key, p_session);
  UPDATE game_accounts.handovers
     SET status = 'rekey_requested', key_version = key_version + 1, rekeys_used = rekeys_used + 1,
         rekey_requested_at = now(), rekey_due_at = now() + p_redeliver, takeover_due_at = NULL
   WHERE order_id = p_order;
  INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload)
  VALUES ('game_accounts.rekey.requested', p_order, jsonb_build_object('keyVersion', h.key_version + 1, 'dueAt', now() + p_redeliver));
  RETURN h.key_version + 1;
END $$;

-- DV-37: the seller did not seal again in time; the case goes to a dispute (Unit 7)
CREATE FUNCTION game_accounts.rekey_overdue(p_order uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  UPDATE game_accounts.handovers SET status = 'disputed', disputed_at = clock_timestamp(), rekey_due_at = NULL
   WHERE order_id = p_order AND status = 'rekey_requested' AND clock_timestamp() >= rekey_due_at;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO game_accounts.outbox (event_type, aggregate_id, payload)
  VALUES ('game_accounts.rekey.overdue', p_order, '{}');
  RETURN true;
END $$;

-- a credentials_invalid dispute withdrawn by the buyer (FR-DSP-10): the takeover resumes; if its
-- window has already ended, the next job run completes it
CREATE FUNCTION game_accounts.dispute_withdrawn(p_order uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE game_accounts.handovers SET status = 'delivered', takeover_due_at = coalesce(takeover_due_at, now()), rekey_due_at = NULL
   WHERE order_id = p_order AND status = 'disputed';
  IF NOT FOUND THEN RAISE EXCEPTION 'handover is not disputed' USING ERRCODE = 'check_violation'; END IF;
END $$;

-- escrow refunded before the delivery event, or escrow terminal after it (from Unit 2 events):
-- the ciphertext is deleted (FR-GAM-19); after a sale the claim is released (FR-GAM-04)
CREATE FUNCTION game_accounts.finish(p_order uuid, p_before_delivery boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE h game_accounts.handovers;
BEGIN
  SELECT * INTO h FROM game_accounts.handovers WHERE order_id = p_order FOR UPDATE;
  IF NOT FOUND OR h.status IN ('cancelled', 'closed') THEN RETURN; END IF;
  UPDATE game_accounts.sealed_credentials SET enc = NULL, ciphertext = NULL, deleted_at = now()
   WHERE order_id = p_order AND deleted_at IS NULL;
  IF p_before_delivery THEN
    UPDATE game_accounts.handovers SET status = 'cancelled', cancelled_at = now() WHERE order_id = p_order;
  ELSE
    UPDATE game_accounts.handovers SET status = 'closed', closed_at = now() WHERE order_id = p_order;
    UPDATE game_accounts.claims SET released_at = now(), release_reason = 'escrow_terminal'
     WHERE listing_id = h.listing_id AND released_at IS NULL;
  END IF;
END $$;

CREATE FUNCTION game_accounts.closed_without_ciphertext() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('cancelled', 'closed') AND EXISTS (SELECT 1 FROM game_accounts.sealed_credentials
       WHERE order_id = NEW.order_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'FR-GAM-19: ciphertext must be deleted when the handover ends' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER handover_ciphertext_deleted AFTER UPDATE OF status ON game_accounts.handovers
  FOR EACH ROW EXECUTE FUNCTION game_accounts.closed_without_ciphertext();

-- =====================================================================
-- Grants (SEC-INF-03)
-- =====================================================================
GRANT USAGE ON SCHEMA game_accounts TO tb_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA game_accounts TO tb_app;
REVOKE UPDATE ON game_accounts.access_log, game_accounts.confirmations, game_accounts.buyer_keys FROM tb_app;
`;
