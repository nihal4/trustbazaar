import 'reflect-metadata';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { ARGON2_PARAMS } from './modules/identity/crypto/password';
import { initialPassword } from './modules/identity/services/staff.service';

// The first administrator (FR-OPS-04; Unit 1 section 4.4): never through the web interface, only by this
// command, run in the backend container (which has no npm, U1-04 Decisions log):
//   docker compose exec backend node dist/staff-bootstrap.js --email admin@example.org --name "Full Name"
// (npm run staff:bootstrap -- ... does the same outside the container.)
// It refuses if any administrator exists; the database also allows only one account without a creator
// (staff_single_bootstrap). The account starts in pending_mfa; its generated password is printed once,
// for the person running the command, who signs in, sets a new password and enrols TOTP. Audited.
export async function bootstrapAdministrator(ds: DataSource, email: string, displayName: string): Promise<{ id: string; password: string }> {
  return ds.transaction(async (m) => {
    await m.query(`LOCK TABLE identity.staff_accounts IN SHARE ROW EXCLUSIVE MODE`);
    const [admin] = await m.query(`SELECT 1 FROM identity.staff_accounts WHERE role = 'administrator' LIMIT 1`);
    if (admin) throw new Error('an administrator already exists; create further staff in the console');
    const password = initialPassword();
    const hash = await argon2.hash(password, ARGON2_PARAMS);
    const [{ id }] = await m.query(
      `INSERT INTO identity.staff_accounts (email, display_name, role, status, password_hash) VALUES ($1, $2, 'administrator', 'pending_mfa', $3) RETURNING id`,
      [email.trim().toLowerCase(), displayName.trim(), hash],
    );
    await m.query(
      `INSERT INTO audit.events (actor_type, action, object_type, object_id, after_state, reason)
       VALUES ('system', 'staff.account.bootstrapped', 'staff', $1, $2, 'deployment command')`,
      [id, JSON.stringify({ email: email.trim().toLowerCase(), role: 'administrator', status: 'pending_mfa' })],
    );
    return { id, password };
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const email = arg('email');
  const name = arg('name');
  if (!url) throw new Error('DATABASE_URL is required');
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email) || !name || name.trim().length < 2) {
    throw new Error('usage: node dist/staff-bootstrap.js --email admin@example.org --name "Full Name"');
  }
  const ds = await new DataSource({ type: 'postgres', url, synchronize: false }).initialize();
  try {
    const { id, password } = await bootstrapAdministrator(ds, email, name);
    console.log(JSON.stringify({ msg: 'administrator created', id, email: email.trim().toLowerCase(), status: 'pending_mfa' }));
    // Printed once, to the operator's terminal only; it is not logged anywhere else.
    console.log(`First password (sign in at /staff, then set your own and enrol an authenticator): ${password}`);
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(JSON.stringify({ msg: 'staff bootstrap refused', error: err instanceof Error ? err.message : String(err) }));
    process.exit(1);
  });
}
