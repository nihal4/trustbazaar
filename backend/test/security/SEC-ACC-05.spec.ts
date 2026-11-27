import { randomUUID } from 'crypto';
import { submitKyc, suite } from './setup';

// SEC-ACC-05: staff views mask personal data by default and show the full value only where the task needs it, logging
// each such display.
const s = suite();

describe('SEC-ACC-05 masking in staff views', () => {
  it("SEC-ACC-05 the queues and case files carry no member's phone number or e-mail address", async () => {
    const member = await s.signedIn({ kyc: 'unsubmitted' });
    await submitKyc(member.b);
    const op = await s.signedInStaff('operator');
    const seen: string[] = [];
    for (const path of ['/staff/kyc/queue', '/staff/queues/disputes', '/staff/queues/reports', '/staff/queues/flagged', '/staff/queues/payout-accounts']) {
      const r = await op.b.get(path);
      if (r.status === 200) seen.push(await r.text());
    }
    expect(seen.length).toBeGreaterThan(0);
    const all = seen.join('\n');
    expect(all).not.toContain(member.a.phone);
    expect(all).not.toContain(member.a.phone.slice(-10));
    expect(all.toLowerCase()).not.toContain(member.a.email.toLowerCase());
  });

  it('SEC-ACC-05 the full NID number is shown only to the operator reviewing that submission, and each display is audited', async () => {
    const member = await s.signedIn({ kyc: 'unsubmitted' });
    const { id, docNumber } = await submitKyc(member.b);
    const reviewer = await s.signedInStaff('operator');
    const bystander = await s.signedInStaff('operator');
    // before claiming it nobody sees the details
    expect([403, 409]).toContain((await reviewer.b.get(`/staff/kyc/submissions/${id}`)).status);
    expect((await reviewer.b.post(`/staff/kyc/submissions/${id}/claim`)).status).toBe(200);
    const details = await reviewer.b.get(`/staff/kyc/submissions/${id}`);
    expect(details.status).toBe(200);
    expect(await details.text()).toContain(docNumber); // the task needs it: compare with the document
    expect([403, 409]).toContain((await bystander.b.get(`/staff/kyc/submissions/${id}`)).status);
    const audit = await s.fx.query(`SELECT actor_id FROM audit.events WHERE action = 'kyc.details.viewed' AND object_id = $1`, [id]);
    expect(audit).toEqual([{ actor_id: reviewer.s.staffId }]);
  });

  it('SEC-ACC-05 the queue of KYC submissions shows no document number', async () => {
    const member = await s.signedIn({ kyc: 'unsubmitted' });
    const { docNumber } = await submitKyc(member.b, { fullName: `Masked Person ${randomUUID().slice(0, 6)}` });
    const op = await s.signedInStaff('operator');
    expect(await (await op.b.get('/staff/kyc/queue')).text()).not.toContain(docNumber);
  });
});
