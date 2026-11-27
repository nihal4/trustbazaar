import { suite } from './setup';

// SEC-SES-06: staff sessions have the shorter idle and absolute limits of CP-03 (15 minutes idle, 8 hours in all).
const s = suite();

describe('SEC-SES-06 staff session limits', () => {
  const limits = async (staffId: string) =>
    (
      await s.fx.query<{ idle: number; absolute: number; id: string }>(
        `SELECT id, extract(epoch FROM idle_expires_at - created_at)::int AS idle, extract(epoch FROM absolute_expires_at - created_at)::int AS absolute
         FROM identity.sessions WHERE staff_id = $1 AND ended_at IS NULL`,
        [staffId],
      )
    )[0];

  it("SEC-SES-06 a staff session is created with CP-03's limits, shorter than a member's", async () => {
    const { s: st } = await s.signedInStaff('operator');
    const { a } = await s.signedIn();
    const staff = await limits(st.staffId);
    expect({ idle: staff.idle, absolute: staff.absolute }).toEqual({ idle: 15 * 60, absolute: 8 * 3600 });
    const [member] = await s.fx.query<{ idle: number; absolute: number }>(
      `SELECT extract(epoch FROM idle_expires_at - created_at)::int AS idle, extract(epoch FROM absolute_expires_at - created_at)::int AS absolute
       FROM identity.sessions WHERE user_id = $1 AND ended_at IS NULL`,
      [a.userId],
    );
    expect(staff.idle).toBeLessThan(member.idle);
    expect(staff.absolute).toBeLessThan(member.absolute);
  });

  it('SEC-SES-06 a staff session idle past 15 minutes is refused, and so is one past 8 hours although in use', async () => {
    const idle = await s.signedInStaff('operator');
    const row = await limits(idle.s.staffId);
    await s.fx.query(`UPDATE identity.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1`, [row.id]);
    expect((await idle.b.get('/staff/me')).status).toBe(401);

    const old = await s.signedInStaff('administrator');
    const r2 = await limits(old.s.staffId);
    // in use a minute ago, but created more than 8 hours ago: the idle limit cannot outlast the absolute one (a CHECK)
    await s.fx.query(
      `UPDATE identity.sessions SET last_seen_at = now() - interval '1 minute', idle_expires_at = now() - interval '1 second', absolute_expires_at = now() - interval '1 second' WHERE id = $1`,
      [r2.id],
    );
    expect((await old.b.get('/staff/me')).status).toBe(401);
  });

  it('SEC-SES-06 refreshing moves the idle limit on by 15 minutes, but never past the absolute one', async () => {
    const { s: st, b } = await s.signedInStaff('operator');
    const row = await limits(st.staffId);
    await s.fx.query(
      `UPDATE identity.sessions SET idle_expires_at = now() + interval '1 minute', absolute_expires_at = now() + interval '5 minutes' WHERE id = $1`,
      [row.id],
    );
    expect((await b.post('/staff/auth/refresh')).status).toBe(204);
    const [after] = await s.fx.query<{ capped: boolean }>(
      `SELECT abs(extract(epoch FROM absolute_expires_at - idle_expires_at)) < 0.001 AS capped FROM identity.sessions WHERE staff_id = $1 AND ended_at IS NULL`,
      [st.staffId],
    );
    expect(after.capped).toBe(true);
  });
});
