import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { forEachDue, JobRunner } from '../../src/kernel/jobs/job-runner';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// K-05: the job runner's claim pattern and Unit 1's first jobs (NFR-REL-03; docs/design/09_integration.pdf
// "Scheduled jobs"), against PostgreSQL. The background runner is off in this file.
describe('scheduled jobs', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let db: DataSource;
  let jobs: JobRunner;
  const before = process.env.JOB_RUNNER;

  beforeAll(async () => {
    process.env.JOB_RUNNER = 'off';
    t = await startApp();
    fx = await IdentityFixtures.open();
    db = t.app.get(DataSource);
    jobs = t.app.get(JobRunner);
  });
  afterAll(async () => {
    if (before === undefined) delete process.env.JOB_RUNNER;
    else process.env.JOB_RUNNER = before;
    await fx?.close();
    await t?.close();
  });

  /** Open proposals that fell due during an "outage". */
  async function staleProposals(n: number, action: string) {
    const by = await fx.staff('administrator');
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [{ id }] = await fx.query<{ id: string }>(
        `INSERT INTO identity.approvals (action, target_type, target_id, reason, required_role, proposed_by, proposed_at, expires_at)
         VALUES ($1, 'test', $2, 'A proposal nobody decided', 'administrator', $3, now() - interval '80 hours', now() - interval '8 hours')
         RETURNING id`,
        [action, randomUUID(), by],
      );
      ids.push(id);
    }
    return ids;
  }

  it('NFR-REL-03 three workers claiming due rows at once handle each exactly once (SKIP LOCKED)', async () => {
    const action = `test.claim_${randomUUID().slice(0, 8).replace(/\d/g, 'x')}`;
    const ids = await staleProposals(25, action);
    const handled: string[] = [];
    const worker = () =>
      forEachDue<{ id: string }>(
        db,
        `SELECT id FROM identity.approvals WHERE action = $1 AND decision IS NULL AND expires_at <= now() LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [action],
        async (row, m) => {
          handled.push(row.id);
          await new Promise((r) => setTimeout(r, 3));
          await m.query(`UPDATE identity.approvals SET decision = 'expired', decided_at = now() WHERE id = $1 AND decision IS NULL`, [row.id]);
        },
      );
    const counts = await Promise.all([worker(), worker(), worker()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(25);
    expect([...handled].sort()).toEqual([...ids].sort());
  });

  it('NFR-REL-03 the claim helper refuses a query without SKIP LOCKED', async () => {
    await expect(forEachDue(db, 'SELECT 1', [], async () => undefined)).rejects.toThrow('FOR UPDATE SKIP LOCKED');
  });

  it('DV-5 the expiry job closes proposals past their 72 hours, once, and audits each', async () => {
    const action = `test.expire_${randomUUID().slice(0, 8).replace(/\d/g, 'x')}`;
    const ids = await staleProposals(3, action);
    const stats = await jobs.runNow('identity.approvals.expire');
    expect(stats.failures).toBe(0);
    const rows = await fx.query<{ decision: string }>(`SELECT decision FROM identity.approvals WHERE id = ANY($1)`, [ids]);
    expect(rows.every((r) => r.decision === 'expired')).toBe(true);
    await jobs.runNow('identity.approvals.expire');
    const audit = await fx.query(`SELECT object_id FROM audit.events WHERE action = 'staff.approval.expired' AND object_id = ANY($1)`, [ids]);
    expect(audit).toHaveLength(3); // the second run found nothing to do
  });

  it('SEC-LOG-02 the daily job verifies the audit hash chain', async () => {
    const stats = await jobs.runNow('identity.audit.verify');
    expect(stats).toMatchObject({ failures: 0, lastError: null });
    expect(stats.handled).toBeGreaterThan(0);
    expect(jobs.stats().map((s) => s.name)).toEqual(expect.arrayContaining(['identity.approvals.expire', 'identity.audit.verify']));
  });
});
