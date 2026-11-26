import { MigrationInterface, QueryRunner } from 'typeorm';

// Unit 2, U10-23 (Decisions log, 2026-11-26; agreed with the user): the buyer's default payment method, kept on the account.
// Only a masked label is kept (kind, a card's brand, the last four digits). Runs as tb_owner (SEC-INF-03).
// docs/design/sql/02_orders_payments.sql holds the result.
export class SavedPaymentMethods1793491200034 implements MigrationInterface {
  name = 'SavedPaymentMethods1793491200034';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`-- The buyer's default payment method (U10-23, Decisions log): only what is needed to show it again, never the card number, the
-- security code, the wallet PIN or a full wallet number. One row a user; clearing it sets cleared_at (no DELETE is granted).
CREATE TABLE payments.saved_payment_methods (
  user_id     uuid PRIMARY KEY REFERENCES identity.users(id),
  kind        varchar(8)  NOT NULL CHECK (kind IN ('card', 'bkash', 'nagad')),
  brand       varchar(24),                                   -- a card's brand, such as Visa
  last4       char(4)     NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz,
  CONSTRAINT brand_only_card CHECK (brand IS NULL OR kind = 'card')
);`);
    await q.query(`GRANT SELECT, INSERT, UPDATE ON payments.saved_payment_methods TO tb_app`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE payments.saved_payment_methods`);
  }
}
