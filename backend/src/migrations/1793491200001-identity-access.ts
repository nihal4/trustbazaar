import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 1: a frozen copy of docs/design/sql/01_identity_access.sql as of this migration (I-60, NFR-MNT-04).
// Never edit an applied migration: a later change to the design file comes as a new migration.
// Runs as tb_owner (SEC-INF-03). down() drops the schemas identity, audit; extensions and roles stay.
export class IdentityAccess1793491200001 implements MigrationInterface {
  name = 'IdentityAccess1793491200001';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP SCHEMA IF EXISTS identity, audit CASCADE');
  }
}

const SQL = String.raw`-- =====================================================================
-- TrustBazaar  -  Unit 1: Identity & Access  -  PostgreSQL 15 schema
-- Design document: docs/design/01_identity_access.pdf
-- Requirements: SRS v2.0 (FR-ACC, FR-KYC, FR-OPS-03..07, FR-PRV-01,
--               FR-TNS-06, SEC-AUTH, SEC-SES, SEC-ACC, SEC-DAT, SEC-LOG)
--
-- Conventions (design convention DC-4):
--   * one schema per unit; this unit owns schemas "identity" and "audit"
--   * primary keys are random UUIDs (gen_random_uuid), never sequential
--     for objects that appear in URLs (SEC-DAT-11)
--   * all times are timestamptz (UTC)
--   * *_enc columns hold AES-256-GCM ciphertext produced by the
--     application ("v<key>|iv|ciphertext|tag"); *_bidx columns hold
--     HMAC-SHA-256 blind indexes (SEC-DAT-03); *_hash columns hold
--     SHA-256 of a random secret, or an Argon2id string for passwords
--   * append-only tables are protected by trigger AND by grants
-- Must run as the migration role (tb_migrator); the application connects
-- as tb_app, which cannot change the schema (SEC-INF-03).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() for the audit hash chain

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS audit;

-- ---------------------------------------------------------------- types
CREATE TYPE identity.kyc_status AS ENUM
  ('unsubmitted', 'pending_review', 'verified', 'rejected', 'revoked');          -- FR-KYC-05
CREATE TYPE identity.account_status AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE identity.kyc_submission_status AS ENUM
  ('pending_review', 'approved', 'rejected');
CREATE TYPE identity.kyc_doc_type AS ENUM ('nid', 'passport');
CREATE TYPE identity.kyc_file_kind AS ENUM
  ('doc_front', 'doc_back', 'passport_photo_page', 'selfie_neutral', 'selfie_action');
CREATE TYPE identity.kyc_reason AS ENUM                                         -- FR-KYC-06
  ('image_unreadable', 'selfie_mismatch', 'liveness_failed', 'document_expired',
   'details_mismatch', 'underage', 'duplicate_identity', 'blacklisted', 'other');
CREATE TYPE identity.principal_type AS ENUM ('user', 'staff');
CREATE TYPE identity.staff_role AS ENUM ('operator', 'administrator');
CREATE TYPE identity.staff_status AS ENUM ('pending_mfa', 'active', 'disabled');
CREATE TYPE identity.otp_purpose AS ENUM
  ('register_phone', 'step_up', 'contact_change_phone', 'password_reset');
CREATE TYPE identity.token_purpose AS ENUM ('email_verify', 'email_change', 'password_reset');
CREATE TYPE identity.session_end_reason AS ENUM
  ('logout', 'user_ended', 'password_changed', 'refresh_reuse', 'suspended',
   'closed', 'staff_disabled', 'emergency', 'mfa_reset');
CREATE TYPE identity.approval_decision AS ENUM ('approved', 'rejected', 'expired');
CREATE TYPE audit.actor_type AS ENUM ('user', 'staff', 'system', 'provider');

-- ---------------------------------------------------------------- shared trigger: forbid UPDATE/DELETE
CREATE FUNCTION identity.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table %.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- =====================================================================
-- Staff accounts (FR-OPS-03, FR-OPS-04, SEC-AUTH-07)
-- Kept separate from users so that a staff account can never buy, sell or bid.
-- =====================================================================
CREATE TABLE identity.staff_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE CHECK (length(email) <= 254),
  display_name    varchar(60) NOT NULL,
  role            identity.staff_role NOT NULL,
  status          identity.staff_status NOT NULL DEFAULT 'pending_mfa',
  password_hash   text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  -- used for the conflict-of-interest check of FR-OPS-06
  phone_e164      varchar(16) CHECK (phone_e164 ~ '^\+8801[3-9][0-9]{8}$'),
  nid_bidx        bytea CHECK (octet_length(nid_bidx) = 32),
  created_by      uuid REFERENCES identity.staff_accounts(id),   -- NULL only for the first administrator
  created_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz,
  disabled_by     uuid REFERENCES identity.staff_accounts(id),
  CHECK ((status = 'disabled') = (disabled_at IS NOT NULL))
);
-- only one administrator may exist without a creator (the bootstrap one)
CREATE UNIQUE INDEX staff_single_bootstrap ON identity.staff_accounts ((true)) WHERE created_by IS NULL;

CREATE TABLE identity.staff_conflicts (                                         -- FR-OPS-06
  staff_id     uuid NOT NULL REFERENCES identity.staff_accounts(id),
  user_id      uuid NOT NULL,          -- FK added after identity.users exists
  reason       text NOT NULL,
  declared_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, user_id)
);

-- =====================================================================
-- Users (FR-ACC-01..11, FR-KYC-05)
-- =====================================================================
CREATE TABLE identity.users (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name                varchar(40) NOT NULL CHECK (length(btrim(display_name)) >= 2),
  phone_e164                  varchar(16) CHECK (phone_e164 ~ '^\+8801[3-9][0-9]{8}$'),
  phone_verified_at           timestamptz NOT NULL,          -- account exists only after OTP (FR-ACC-02)
  email                       citext CHECK (length(email) <= 254 AND email LIKE '%_@_%'),
  email_verified_at           timestamptz,
  password_hash               text CHECK (password_hash LIKE '$argon2id$%'),   -- SEC-AUTH-03
  password_single_factor_ok   boolean NOT NULL,              -- length >= 15 when set (SEC-AUTH-01)
  password_changed_at         timestamptz NOT NULL DEFAULT now(),
  mfa_enabled                 boolean NOT NULL DEFAULT false,
  kyc_status                  identity.kyc_status NOT NULL DEFAULT 'unsubmitted',
  kyc_status_changed_at       timestamptz NOT NULL DEFAULT now(),
  account_status              identity.account_status NOT NULL DEFAULT 'active',
  area_district               varchar(40),
  approx_lat                  numeric(6,3) CHECK (approx_lat BETWEEN 20.0 AND 27.0),  -- ~110 m grid, Bangladesh
  approx_lng                  numeric(6,3) CHECK (approx_lng BETWEEN 88.0 AND 93.0),
  adult_confirmed_at          timestamptz NOT NULL,          -- FR-ACC-04
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  closed_at                   timestamptz,
  erase_after                 timestamptz,                   -- closed_at + CP-41
  erased_at                   timestamptz,                   -- personal fields removed (FR-PRV-04)
  -- contact details and password may be absent only after erasure
  CHECK (erased_at IS NOT NULL OR (phone_e164 IS NOT NULL AND email IS NOT NULL AND password_hash IS NOT NULL)),
  CHECK (erased_at IS NULL OR account_status = 'closed'),
  CHECK ((account_status = 'closed') = (closed_at IS NOT NULL)),
  -- a password shorter than 15 characters is allowed only while MFA is on (SEC-AUTH-01)
  CHECK (password_single_factor_ok OR mfa_enabled),
  CHECK ((approx_lat IS NULL) = (approx_lng IS NULL))
);
-- contact details are unique among accounts that are not closed (FR-ACC-03)
CREATE UNIQUE INDEX users_phone_live ON identity.users (phone_e164) WHERE account_status <> 'closed';
CREATE UNIQUE INDEX users_email_live ON identity.users (email)      WHERE account_status <> 'closed';
CREATE INDEX users_erase_due ON identity.users (erase_after) WHERE erase_after IS NOT NULL;

ALTER TABLE identity.staff_conflicts
  ADD FOREIGN KEY (user_id) REFERENCES identity.users(id);

CREATE TABLE identity.consents (                                                -- FR-ACC-04, FR-PRV-01/02
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES identity.users(id),
  document     varchar(20) NOT NULL CHECK (document IN ('terms', 'privacy', 'marketing', 'recommendations')),
  version      varchar(20) NOT NULL,
  granted      boolean NOT NULL,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  source_ip    inet
);
CREATE INDEX consents_user ON identity.consents (user_id, document, recorded_at DESC);

-- Registration before the phone is verified. Nothing is created in "users"
-- until the OTP succeeds (FR-ACC-02); rows expire with the OTP.
CREATE TABLE identity.pending_registrations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164       varchar(16) NOT NULL CHECK (phone_e164 ~ '^\+8801[3-9][0-9]{8}$'),
  email            citext NOT NULL,
  display_name     varchar(40) NOT NULL,
  password_hash    text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  password_single_factor_ok boolean NOT NULL CHECK (password_single_factor_ok),  -- no MFA yet => >= 15 chars
  terms_version    varchar(20) NOT NULL,
  privacy_version  varchar(20) NOT NULL,
  adult_confirmed  boolean NOT NULL CHECK (adult_confirmed),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  completed_at     timestamptz,
  source_ip        inet
);
CREATE INDEX pending_reg_phone ON identity.pending_registrations (phone_e164, created_at DESC);

-- =====================================================================
-- One-time secrets: OTPs (SEC-AUTH-09) and link tokens (SEC-AUTH-10)
-- Only hashes are stored.
-- =====================================================================
CREATE TABLE identity.otp_challenges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose                  identity.otp_purpose NOT NULL,
  user_id                  uuid REFERENCES identity.users(id),
  pending_registration_id  uuid REFERENCES identity.pending_registrations(id),
  phone_e164               varchar(16) NOT NULL,
  code_hash                bytea NOT NULL CHECK (octet_length(code_hash) = 32),  -- HMAC-SHA-256(code, pepper)
  bound_to                 text,         -- e.g. session id + action for step-up
  attempts                 smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts             smallint NOT NULL,                                   -- CP-05
  created_at               timestamptz NOT NULL DEFAULT now(),
  expires_at               timestamptz NOT NULL,
  consumed_at              timestamptz,
  CHECK (attempts <= max_attempts),
  CHECK (expires_at > created_at),
  CHECK ((purpose = 'register_phone') = (pending_registration_id IS NOT NULL)),
  CHECK (purpose = 'register_phone' OR user_id IS NOT NULL)
);
CREATE INDEX otp_phone_recent ON identity.otp_challenges (phone_e164, created_at DESC);

CREATE TABLE identity.one_time_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose      identity.token_purpose NOT NULL,
  user_id      uuid NOT NULL REFERENCES identity.users(id),
  token_hash   bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),    -- SHA-256 of 256-bit token
  new_email    citext,                                                         -- for email_change only
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  CHECK ((purpose = 'email_change') = (new_email IS NOT NULL))
);

-- =====================================================================
-- Second factors (FR-ACC-06, SEC-AUTH-07)
-- =====================================================================
CREATE TABLE identity.totp_factors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_type   identity.principal_type NOT NULL,
  user_id          uuid REFERENCES identity.users(id),
  staff_id         uuid REFERENCES identity.staff_accounts(id),
  secret_enc       bytea NOT NULL,          -- AES-256-GCM under the field key
  key_version      smallint NOT NULL,
  confirmed_at     timestamptz,             -- factor counts only once confirmed with a code
  last_used_step   bigint,                  -- rejects reuse of the same 30-s code
  created_at       timestamptz NOT NULL DEFAULT now(),
  removed_at       timestamptz,
  CHECK ((principal_type = 'user')  = (user_id  IS NOT NULL)),
  CHECK ((principal_type = 'staff') = (staff_id IS NOT NULL))
);
CREATE UNIQUE INDEX totp_one_active_user  ON identity.totp_factors (user_id)  WHERE removed_at IS NULL AND user_id  IS NOT NULL;
CREATE UNIQUE INDEX totp_one_active_staff ON identity.totp_factors (staff_id) WHERE removed_at IS NULL AND staff_id IS NOT NULL;

CREATE TABLE identity.recovery_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  totp_factor_id   uuid NOT NULL REFERENCES identity.totp_factors(id),
  code_hash        bytea NOT NULL CHECK (octet_length(code_hash) = 32),
  used_at          timestamptz
);

CREATE TABLE identity.webauthn_credentials (                                    -- staff passkeys (optional)
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id         uuid NOT NULL REFERENCES identity.staff_accounts(id),
  credential_id    bytea NOT NULL UNIQUE,
  public_key       bytea NOT NULL,
  sign_count       bigint NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at     timestamptz,
  removed_at       timestamptz
);

-- =====================================================================
-- Devices and sessions (FR-ACC-08, SEC-AUTH-12, SEC-SES-01..07)
-- A session is one sign-in on one device; its refresh tokens rotate.
-- =====================================================================
CREATE TABLE identity.known_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES identity.users(id),
  device_key_hash bytea NOT NULL CHECK (octet_length(device_key_hash) = 32),
  label           varchar(80),            -- e.g. "Chrome on Android"
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_key_hash)
);

CREATE TABLE identity.sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- "sid" claim of the access token
  principal_type       identity.principal_type NOT NULL,
  user_id              uuid REFERENCES identity.users(id),
  staff_id             uuid REFERENCES identity.staff_accounts(id),
  device_id            uuid REFERENCES identity.known_devices(id),
  user_agent           varchar(300),
  first_ip             inet,
  approx_location      varchar(60),
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at         timestamptz NOT NULL DEFAULT now(),
  idle_expires_at      timestamptz NOT NULL,      -- CP-02 / CP-03
  absolute_expires_at  timestamptz NOT NULL,
  ended_at             timestamptz,
  end_reason           identity.session_end_reason,
  CHECK ((principal_type = 'user')  = (user_id  IS NOT NULL)),
  CHECK ((principal_type = 'staff') = (staff_id IS NOT NULL)),
  CHECK (idle_expires_at <= absolute_expires_at),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX sessions_user_active  ON identity.sessions (user_id)  WHERE ended_at IS NULL;
CREATE INDEX sessions_staff_active ON identity.sessions (staff_id) WHERE ended_at IS NULL;

CREATE TABLE identity.refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES identity.sessions(id),
  token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz,
  replaced_by   uuid REFERENCES identity.refresh_tokens(id) DEFERRABLE INITIALLY DEFERRED,  -- rotation inserts the successor after marking this row used
  CHECK ((used_at IS NULL) = (replaced_by IS NULL))
);
-- at most one unused refresh token per session: rotation is strictly linear (SEC-SES-02)
CREATE UNIQUE INDEX refresh_one_live ON identity.refresh_tokens (session_id) WHERE used_at IS NULL;

-- =====================================================================
-- KYC (FR-KYC-01..12, SEC-DAT-02/03, SEC-ACC-06)
-- =====================================================================
CREATE TABLE identity.kyc_submissions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES identity.users(id),
  doc_type           identity.kyc_doc_type NOT NULL,
  doc_number_enc     bytea,
  doc_number_bidx    bytea CHECK (octet_length(doc_number_bidx) = 32),
  full_name_enc      bytea,
  dob_enc            bytea,
  -- second, non-blocking duplicate signal: HMAC of normalised name + date of birth. One person can
  -- hold NIDs in different number formats, so the document number alone can miss a duplicate.
  person_bidx        bytea CHECK (octet_length(person_bidx) = 32),
  key_version        smallint NOT NULL,
  is_adult           boolean NOT NULL,                     -- computed from DOB at submission (FR-KYC-03)
  liveness_action    varchar(24) NOT NULL,                 -- the random action asked for (FR-KYC-02)
  routed_flags       text[] NOT NULL DEFAULT '{}'          -- reasons the submission needs closer review
                     CHECK (routed_flags <@ ARRAY['duplicate','possible_duplicate','blacklisted','underage','precheck']::text[]),
  precheck           jsonb,                                -- advisory only (FR-KYC-11)
  status             identity.kyc_submission_status NOT NULL DEFAULT 'pending_review',
  claimed_by         uuid REFERENCES identity.staff_accounts(id),   -- review assignment (SEC-ACC-06)
  claimed_until      timestamptz,
  decided_by         uuid REFERENCES identity.staff_accounts(id),
  decided_at         timestamptz,
  rejection_reason   identity.kyc_reason,
  rejection_note     varchar(500),
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  erased_at          timestamptz,                          -- retention job (SRS Table 7.2)
  CHECK (erased_at IS NOT NULL OR (doc_number_enc IS NOT NULL AND doc_number_bidx IS NOT NULL
                                   AND full_name_enc IS NOT NULL AND dob_enc IS NOT NULL)),
  CHECK (erased_at IS NULL OR status <> 'pending_review'),
  CHECK ((status = 'pending_review') = (decided_at IS NULL)),
  CHECK ((decided_at IS NULL) = (decided_by IS NULL)),
  CHECK ((status = 'rejected') = (rejection_reason IS NOT NULL)),
  CHECK (status <> 'approved' OR is_adult),
  CHECK ((claimed_by IS NULL) = (claimed_until IS NULL))
);
-- one open submission per user
CREATE UNIQUE INDEX kyc_one_pending ON identity.kyc_submissions (user_id) WHERE status = 'pending_review';
CREATE INDEX kyc_bidx        ON identity.kyc_submissions (doc_number_bidx);
CREATE INDEX kyc_person_bidx ON identity.kyc_submissions (person_bidx);
CREATE INDEX kyc_queue       ON identity.kyc_submissions (submitted_at) WHERE status = 'pending_review';
CREATE INDEX kyc_user_recent ON identity.kyc_submissions (user_id, submitted_at DESC);

CREATE TABLE identity.kyc_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  uuid NOT NULL REFERENCES identity.kyc_submissions(id),
  kind           identity.kyc_file_kind NOT NULL,
  storage_key    varchar(80) NOT NULL UNIQUE,               -- random name on the encrypted volume
  wrapped_dek    bytea,                                     -- per-file key, wrapped by the KEK; NULL once erased
  key_version    smallint NOT NULL,
  sha256         bytea NOT NULL CHECK (octet_length(sha256) = 32),   -- of the re-encoded plaintext
  mime           varchar(20) NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size      integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),   -- CP-33
  created_at     timestamptz NOT NULL DEFAULT now(),
  erased_at      timestamptz,                               -- blob deleted and key destroyed
  CHECK ((wrapped_dek IS NULL) = (erased_at IS NOT NULL)),
  UNIQUE (submission_id, kind)
);

-- The guarantee "one identity, one account" (FR-KYC-04) is enforced here:
-- a row is inserted when a submission is approved, inside the same
-- transaction; the primary key makes a second account impossible.
CREATE TABLE identity.identity_claims (
  doc_number_bidx  bytea PRIMARY KEY CHECK (octet_length(doc_number_bidx) = 32),
  user_id          uuid NOT NULL UNIQUE REFERENCES identity.users(id),
  submission_id    uuid NOT NULL REFERENCES identity.kyc_submissions(id),
  claimed_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.kyc_status_history (                                      -- FR-KYC-05, append-only
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES identity.users(id),
  from_status    identity.kyc_status NOT NULL,
  to_status      identity.kyc_status NOT NULL,
  actor_type     audit.actor_type NOT NULL,
  actor_id       uuid,
  submission_id  uuid REFERENCES identity.kyc_submissions(id),
  approval_id    uuid,                                       -- FK added below
  reason         text,
  at             timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status <> to_status)
);
CREATE INDEX kyc_hist_user ON identity.kyc_status_history (user_id, at);
CREATE TRIGGER kyc_history_append_only BEFORE UPDATE OR DELETE ON identity.kyc_status_history
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- =====================================================================
-- Four-eyes approvals (FR-OPS-05, CP-30). Used by every unit; owned here
-- because it is an access-control mechanism over staff identities.
-- =====================================================================
CREATE TABLE identity.approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        varchar(60) NOT NULL,          -- e.g. 'kyc.revoke', 'blacklist.add', 'staff.mfa_reset'
  target_type   varchar(40) NOT NULL,
  target_id     uuid NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 10),
  required_role identity.staff_role NOT NULL,
  proposed_by   uuid NOT NULL REFERENCES identity.staff_accounts(id),
  proposed_at   timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  decided_by    uuid REFERENCES identity.staff_accounts(id),
  decided_at    timestamptz,
  decision      identity.approval_decision,
  decision_note text,
  executed_at   timestamptz,
  CHECK (decided_by IS NULL OR decided_by <> proposed_by),            -- never the same person
  CHECK ((decision IS NULL) = (decided_at IS NULL)),
  -- IS NOT DISTINCT FROM: a plain '=' is NULL when decision is NULL, and a NULL check passes
  CHECK (decision IS NOT DISTINCT FROM 'expired' OR (decision IS NULL) = (decided_by IS NULL)),
  CHECK (executed_at IS NULL OR decision IS NOT DISTINCT FROM 'approved')
);
CREATE INDEX approvals_open ON identity.approvals (proposed_at) WHERE decision IS NULL;
-- only one open proposal per action and target
CREATE UNIQUE INDEX approvals_one_open ON identity.approvals (action, target_id) WHERE decision IS NULL;

ALTER TABLE identity.kyc_status_history
  ADD FOREIGN KEY (approval_id) REFERENCES identity.approvals(id);

-- =====================================================================
-- NID blacklist (FR-TNS-06, FR-GAM-18). Entries are added or removed only
-- through an executed approval.
-- =====================================================================
CREATE TABLE identity.nid_blacklist (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_number_bidx     bytea NOT NULL CHECK (octet_length(doc_number_bidx) = 32),
  source              varchar(30) NOT NULL CHECK (source IN ('game_account_recovery', 'fraud_decision')),
  reason              text NOT NULL,
  related_order_id    uuid,                 -- order unit; no cross-unit FK (DC-5)
  added_by            uuid NOT NULL REFERENCES identity.staff_accounts(id),
  add_approval_id     uuid NOT NULL REFERENCES identity.approvals(id),
  added_at            timestamptz NOT NULL DEFAULT now(),
  removed_at          timestamptz,
  removed_by          uuid REFERENCES identity.staff_accounts(id),
  remove_approval_id  uuid REFERENCES identity.approvals(id),
  CHECK ((removed_at IS NULL) = (remove_approval_id IS NULL)),
  CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);
CREATE UNIQUE INDEX blacklist_active ON identity.nid_blacklist (doc_number_bidx) WHERE removed_at IS NULL;

-- =====================================================================
-- Audit log (SEC-LOG-01..04). Shared by all units; tamper-evident chain.
-- =====================================================================
CREATE TABLE audit.events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- position in the hash chain, assigned under the chain lock. Ids are allocated before the lock,
  -- so under concurrent inserts id order and chain order can differ; verification uses chain_pos.
  chain_pos       bigint NOT NULL UNIQUE,
  at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_type      audit.actor_type NOT NULL,
  actor_id        uuid,
  action          varchar(80) NOT NULL CHECK (action ~ '^[a-z]+(\.[a-z_]+)+$'),   -- 'kyc.file.viewed'
  object_type     varchar(40),
  object_id       uuid,
  before_state    jsonb,
  after_state     jsonb,
  reason          text,
  approval_id     uuid,
  source_ip       inet,
  correlation_id  uuid,
  prev_hash       bytea NOT NULL,
  hash            bytea NOT NULL UNIQUE
);
CREATE INDEX audit_object ON audit.events (object_type, object_id, at);
CREATE INDEX audit_actor  ON audit.events (actor_type, actor_id, at);

-- The chain: hash = SHA-256(prev_hash || canonical text of the row).
-- An advisory lock serialises inserts so that the chain has no forks.
CREATE FUNCTION audit.chain_hash() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_hash bytea;
  last_pos  bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(7461001);           -- constant key for the audit chain
  SELECT e.hash, e.chain_pos INTO last_hash, last_pos FROM audit.events e ORDER BY e.chain_pos DESC LIMIT 1;
  NEW.chain_pos := coalesce(last_pos, 0) + 1;
  NEW.at        := clock_timestamp();               -- time taken under the lock, so it never goes backwards
  NEW.prev_hash := coalesce(last_hash, '\x00'::bytea);
  NEW.hash := digest(
      NEW.prev_hash ||
      convert_to(concat_ws('|', NEW.chain_pos, to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                 NEW.actor_type, NEW.actor_id, NEW.action, NEW.object_type, NEW.object_id,
                 NEW.before_state::text, NEW.after_state::text, NEW.reason, NEW.approval_id,
                 host(NEW.source_ip), NEW.correlation_id), 'UTF8'),
      'sha256');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_chain BEFORE INSERT ON audit.events
  FOR EACH ROW EXECUTE FUNCTION audit.chain_hash();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit.events
  FOR EACH ROW EXECUTE FUNCTION identity.forbid_change();

-- Verification used by the scheduled chain check (SEC-LOG-02): returns the id of
-- the first entry (in chain order) whose hash does not match, or NULL if intact.
-- A deleted entry also breaks the chain, because its successor's prev_hash no longer matches.
CREATE FUNCTION audit.verify_chain() RETURNS bigint LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit.events;
  expected_prev bytea := '\x00'::bytea;
  calc bytea;
BEGIN
  FOR r IN SELECT * FROM audit.events ORDER BY chain_pos LOOP
    IF r.prev_hash <> expected_prev THEN RETURN r.id; END IF;
    calc := digest(
      r.prev_hash ||
      convert_to(concat_ws('|', r.chain_pos, to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                 r.actor_type, r.actor_id, r.action, r.object_type, r.object_id,
                 r.before_state::text, r.after_state::text, r.reason, r.approval_id,
                 host(r.source_ip), r.correlation_id), 'UTF8'),
      'sha256');
    IF calc <> r.hash THEN RETURN r.id; END IF;
    expected_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- =====================================================================
-- Transactional outbox (design convention DC-6). Events that must not be
-- lost (security notices, KYC decisions) are written in the same
-- transaction as the change; a worker publishes them and marks them sent.
-- =====================================================================
CREATE TABLE identity.outbox (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type     varchar(80) NOT NULL CHECK (event_type ~ '^identity\.[a-z_]+\.[a-z_]+$'),
  aggregate_id   uuid NOT NULL,
  payload        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  attempts       smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at  timestamptz
);
CREATE INDEX outbox_pending ON identity.outbox (next_attempt_at) WHERE dispatched_at IS NULL;

-- =====================================================================
-- Rule: kyc_status may change only along permitted edges (FR-KYC-05).
-- The application writes kyc_status_history in the same transaction;
-- this trigger is the last line of defence.
-- =====================================================================
CREATE FUNCTION identity.check_kyc_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status THEN
    IF NOT ((OLD.kyc_status, NEW.kyc_status) IN (
        ('unsubmitted'::identity.kyc_status, 'pending_review'::identity.kyc_status),
        ('rejected',       'pending_review'),
        ('pending_review', 'verified'),
        ('pending_review', 'rejected'),
        ('verified',       'revoked'))) THEN
      RAISE EXCEPTION 'kyc_status % -> % is not permitted', OLD.kyc_status, NEW.kyc_status
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.kyc_status_changed_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER users_kyc_transition BEFORE UPDATE ON identity.users
  FOR EACH ROW EXECUTE FUNCTION identity.check_kyc_transition();

-- =====================================================================
-- Roles and grants (SEC-INF-03, SEC-LOG-04)
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tb_app') THEN
    CREATE ROLE tb_app LOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA identity, audit TO tb_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA identity TO tb_app;
GRANT DELETE ON identity.pending_registrations, identity.otp_challenges,
               identity.one_time_tokens, identity.staff_conflicts TO tb_app;  -- housekeeping only
REVOKE UPDATE ON identity.kyc_status_history FROM tb_app;
GRANT SELECT, INSERT ON audit.events TO tb_app;                               -- no UPDATE / DELETE
GRANT EXECUTE ON FUNCTION audit.verify_chain() TO tb_app;
`;
