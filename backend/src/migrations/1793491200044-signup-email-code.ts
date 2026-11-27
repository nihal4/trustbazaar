import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-25 (Decisions log, 2026-11-27; agreed with the user): registration is name, e-mail, password, a code sent to the e-mail address, then the mobile
// number and the terms. The sign-up is kept in Redis until the account is made (the pending_registrations table and the SMS challenge purpose
// stay in the schema, unused by registration). The number is no longer confirmed by SMS at sign-up, so phone_verified_at may be empty: it is set
// when a phone change is confirmed by SMS. Nothing reads it for a decision today.
export class SignupEmailCode1793491200044 implements MigrationInterface {
  name = 'SignupEmailCode1793491200044';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE identity.users ALTER COLUMN phone_verified_at DROP NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE identity.users SET phone_verified_at = created_at WHERE phone_verified_at IS NULL`);
    await q.query(`ALTER TABLE identity.users ALTER COLUMN phone_verified_at SET NOT NULL`);
  }
}
