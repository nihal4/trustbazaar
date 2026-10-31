import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 9: a frozen copy of docs/design/sql/09_integration.sql as of this migration (I-60, NFR-MNT-04).
// Never edit an applied migration: a later change to the design file comes as a new migration.
// Runs as tb_owner (SEC-INF-03). down() drops the 24 indexes this migration adds; extensions and roles stay.
export class Integration1793491200008 implements MigrationInterface {
  name = 'Integration1793491200008';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(SQL);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query('DROP INDEX IF EXISTS identity.otp_challenges_pending');
    await q.query('DROP INDEX IF EXISTS identity.staff_conflicts_user');
    await q.query('DROP INDEX IF EXISTS identity.kyc_history_submission');
    await q.query('DROP INDEX IF EXISTS identity.recovery_codes_factor');
    await q.query('DROP INDEX IF EXISTS payments.refunds_attempt');
    await q.query('DROP INDEX IF EXISTS payments.refunds_order');
    await q.query('DROP INDEX IF EXISTS payments.provider_events_attempt');
    await q.query('DROP INDEX IF EXISTS payments.payouts_seller');
    await q.query('DROP INDEX IF EXISTS payments.chargebacks_attempt');
    await q.query('DROP INDEX IF EXISTS listings.clarifications_listing');
    await q.query('DROP INDEX IF EXISTS listings.status_history_listing');
    await q.query('DROP INDEX IF EXISTS auctions.auction_strikes_user');
    await q.query('DROP INDEX IF EXISTS auctions.auction_flags_auction');
    await q.query('DROP INDEX IF EXISTS auctions.second_chance_bidder');
    await q.query('DROP INDEX IF EXISTS game_accounts.claims_order');
    await q.query('DROP INDEX IF EXISTS chat.staff_access_thread');
    await q.query('DROP INDEX IF EXISTS disputes.statements_dispute');
    await q.query('DROP INDEX IF EXISTS disputes.evidence_dispute');
    await q.query('DROP INDEX IF EXISTS disputes.disputes_buyer');
    await q.query('DROP INDEX IF EXISTS disputes.disputes_seller');
    await q.query('DROP INDEX IF EXISTS trust.reports_subject');
    await q.query('DROP INDEX IF EXISTS trust.signals_subject');
    await q.query('DROP INDEX IF EXISTS trust.eligibility_buyer');
    await q.query('DROP INDEX IF EXISTS trust.eligibility_seller');
  }
}

const SQL = String.raw`-- =====================================================================
-- TrustBazaar - Unit 9: Integration - PostgreSQL 15 migration
-- Design document: docs/design/09_integration.pdf
-- Loaded after 01_identity_access.sql .. 07_disputes_trust_staff.sql. Changes no rule of any unit:
-- it adds the indexes that the combined schema check found missing on foreign keys that a query, a
-- trigger or a deletion looks rows up by (convention DC-15). Foreign keys to rows that are never
-- deleted, and never looked up by that column (actor columns such as decided_by), stay unindexed.
-- =====================================================================

-- Unit 1
CREATE INDEX IF NOT EXISTS otp_challenges_pending ON identity.otp_challenges (pending_registration_id);  -- pending registrations are deleted
CREATE INDEX IF NOT EXISTS staff_conflicts_user   ON identity.staff_conflicts (user_id);                  -- conflict check at every claim (FR-OPS-06)
CREATE INDEX IF NOT EXISTS kyc_history_submission ON identity.kyc_status_history (submission_id);         -- status tracker (IF-UI-02)
CREATE INDEX IF NOT EXISTS recovery_codes_factor  ON identity.recovery_codes (totp_factor_id);            -- recovery-code sign-in

-- Unit 2
CREATE INDEX IF NOT EXISTS refunds_attempt        ON payments.refunds (attempt_id);                       -- refund-total trigger per payment
CREATE INDEX IF NOT EXISTS refunds_order          ON payments.refunds (order_id);                         -- order view, case file
CREATE INDEX IF NOT EXISTS provider_events_attempt ON payments.provider_events (attempt_id);              -- confirmation path
CREATE INDEX IF NOT EXISTS payouts_seller         ON payments.payouts (seller_id);                        -- payout history (IF-UI-08)
CREATE INDEX IF NOT EXISTS chargebacks_attempt    ON payments.chargebacks (attempt_id);

-- Unit 3
CREATE INDEX IF NOT EXISTS clarifications_listing ON listings.clarifications (listing_id);                -- listing page (FR-LST-07)
CREATE INDEX IF NOT EXISTS status_history_listing ON listings.status_history (listing_id);
CREATE INDEX IF NOT EXISTS auction_strikes_user   ON auctions.strikes (user_id, at);                      -- strike count in the CP-12 window
CREATE INDEX IF NOT EXISTS auction_flags_auction  ON auctions.flags (auction_id);                         -- open flag check (FR-AUC-08)
CREATE INDEX IF NOT EXISTS second_chance_bidder   ON auctions.second_chance_offers (bidder_id);           -- my offers

-- Unit 5
CREATE INDEX IF NOT EXISTS claims_order           ON game_accounts.claims (order_id);                     -- release of the claim at the end

-- Unit 6
CREATE INDEX IF NOT EXISTS staff_access_thread    ON chat.staff_access_log (thread_id);                   -- access log per thread (FR-CHT-10)

-- Unit 7
CREATE INDEX IF NOT EXISTS statements_dispute     ON disputes.statements (dispute_id);                    -- case file (FR-DSP-05)
CREATE INDEX IF NOT EXISTS evidence_dispute       ON disputes.evidence (dispute_id);                      -- CP-33 limit trigger counts per dispute
CREATE INDEX IF NOT EXISTS disputes_buyer         ON disputes.disputes (buyer_id);                        -- earlier disputes of a party
CREATE INDEX IF NOT EXISTS disputes_seller        ON disputes.disputes (seller_id);
CREATE INDEX IF NOT EXISTS reports_subject        ON trust.reports (subject_user);                        -- reports grouped by user
CREATE INDEX IF NOT EXISTS signals_subject        ON trust.signals (subject_user);
CREATE INDEX IF NOT EXISTS eligibility_buyer      ON trust.rating_eligibility (buyer_id);                 -- completed transactions (FR-REV-04)
CREATE INDEX IF NOT EXISTS eligibility_seller     ON trust.rating_eligibility (seller_id);
`;
