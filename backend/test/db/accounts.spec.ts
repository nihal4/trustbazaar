import { inRolledBackTransaction, isRefused } from '../support/db';

// The two accounts of SEC-INF-03 on the migrated database, seen from the application's side (tb_app).
// docs/design/deploy/test_accounts.sh checks the same from outside; these run with the API tests.
describe('the application account (tb_app)', () => {
  it.each([
    ['CREATE TABLE identity.probe (a int)'],
    ['CREATE TABLE public.probe (a int)'],
    ['ALTER TABLE identity.users ADD COLUMN probe int'],
    ['DROP TABLE trust.ratings'],
    ['CREATE SCHEMA probe'],
    ['TRUNCATE chat.messages'],
  ])('SEC-INF-03 cannot change the schema: %s', async (sql) => {
    expect(await inRolledBackTransaction((q) => isRefused(q, sql))).toBe(true);
  });

  it('SEC-INF-03 resolves the extensions in public: citext compares case-insensitively', async () => {
    const found = await inRolledBackTransaction(async (q) => {
      await q.query(
        `INSERT INTO identity.users (display_name, phone_e164, phone_verified_at, email, password_hash,
                                     password_single_factor_ok, adult_confirmed_at)
         VALUES ('Probe', '+8801711999997', now(), 'probe@tb.test', '$argon2id$v=19$x', true, now())`,
      );
      const rows = await q.query(`SELECT count(*)::int AS n FROM identity.users WHERE email = 'PROBE@TB.TEST'`);
      return rows[0].n;
    });
    expect(found).toBe(1);
  });

  it('SEC-LOG-04 appends to the audit log, but cannot change or delete an entry', async () => {
    const result = await inRolledBackTransaction(async (q) => {
      await q.query(`INSERT INTO audit.events (actor_type, action) VALUES ('system', 'test.app_role.insert')`);
      return {
        update: await isRefused(q, `UPDATE audit.events SET reason = 'x'`),
        delete: await isRefused(q, `DELETE FROM audit.events`),
      };
    });
    expect(result).toEqual({ update: true, delete: true });
  });
});
