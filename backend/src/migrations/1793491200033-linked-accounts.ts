import { MigrationInterface, QueryRunner } from 'typeorm';

// Units 1 and 2, U7-09 (Decisions log, 2026-11-17; agreed with the user). Runs as tb_owner (SEC-INF-03).
//   FR-TNS-08: the linked-account check looks accounts up by the browser's device key (Unit 1) and by the payout
//   wallet or bank account (Unit 2). A bank account number is encrypted, so it gets an HMAC blind index made with
//   Unit 1's key, as for identity documents; accounts added before this migration have none.
//   docs/design/sql/01_identity_access.sql and 02_orders_payments.sql hold the result.
export class LinkedAccounts1793491200033 implements MigrationInterface {
  name = 'LinkedAccounts1793491200033';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
CREATE INDEX known_devices_key ON identity.known_devices (device_key_hash);
ALTER TABLE payments.payout_accounts ADD COLUMN account_number_bidx bytea,
  ADD CONSTRAINT bidx_bank_only CHECK (account_number_bidx IS NULL OR (kind = 'bank' AND octet_length(account_number_bidx) = 32));
CREATE INDEX payout_account_wallet ON payments.payout_accounts (wallet_e164) WHERE wallet_e164 IS NOT NULL;
CREATE INDEX payout_account_bidx ON payments.payout_accounts (account_number_bidx) WHERE account_number_bidx IS NOT NULL;`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
DROP INDEX payments.payout_account_bidx;
DROP INDEX payments.payout_account_wallet;
ALTER TABLE payments.payout_accounts DROP CONSTRAINT bidx_bank_only, DROP COLUMN account_number_bidx;
DROP INDEX identity.known_devices_key;`);
  }
}
