import { MigrationInterface, QueryRunner } from 'typeorm';

// U10-25 (Decisions log, 2026-11-26; agreed with the user): the second step by e-mail at sign-in, on by default, and 'remember this device'.
//   identity.users.email_two_step: the member's choice, true by default; with it on (and no authenticator app, and a verified e-mail) every sign-in from a
//   device that is not remembered asks for a 6-digit code sent to the e-mail address. Turned off only after step-up.
//   identity.known_devices.trusted_until: set only after a passed second factor with 'remember this device' ticked (30 days); cleared when the password
//   changes or is reset, when the member signs out everywhere, and when their e-mail address changes. Runs as tb_owner (SEC-INF-03).
export class SigninEmailCode1793491200043 implements MigrationInterface {
  name = 'SigninEmailCode1793491200043';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE identity.users ADD COLUMN email_two_step boolean NOT NULL DEFAULT true`);
    await q.query(`ALTER TABLE identity.known_devices ADD COLUMN trusted_until timestamptz`);
    await q.query(`CREATE FUNCTION identity.clear_device_trust() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE identity.known_devices SET trusted_until = NULL WHERE user_id = NEW.id AND trusted_until IS NOT NULL;
  RETURN NEW;
END $$;`);
    await q.query(`CREATE TRIGGER users_clear_device_trust AFTER UPDATE OF password_hash, email ON identity.users FOR EACH ROW
  WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash OR OLD.email IS DISTINCT FROM NEW.email) EXECUTE FUNCTION identity.clear_device_trust()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER users_clear_device_trust ON identity.users`);
    await q.query(`DROP FUNCTION identity.clear_device_trust()`);
    await q.query(`ALTER TABLE identity.known_devices DROP COLUMN trusted_until`);
    await q.query(`ALTER TABLE identity.users DROP COLUMN email_two_step`);
  }
}
