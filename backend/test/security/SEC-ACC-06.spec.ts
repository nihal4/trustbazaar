import { Browser } from '../support/browser';
import { submitKyc, suite } from './setup';

// SEC-ACC-06: KYC images are viewable only by their owner and by an operator assigned to that submission (or to a case
// involving that user); every view is logged with its reason.
const s = suite();

describe('SEC-ACC-06 KYC image access', () => {
  it('SEC-ACC-06 the owner views their own images; another member cannot, even with the link', async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    await submitKyc(owner.b);
    const { url } = (await (await owner.b.post('/kyc/files/selfie_neutral/view')).json()) as { url: string };
    expect((await owner.b.get(url.replace('/api/v1', ''))).status).toBe(200);
    const other = await s.signedIn({ kyc: 'unsubmitted' });
    expect((await other.b.get(url.replace('/api/v1', ''))).status).toBe(410);
    expect((await new Browser(s.t, s.origin).get(url.replace('/api/v1', ''))).status).toBe(410);
  });

  it('SEC-ACC-06 an operator not assigned to the submission is refused; the assigned one views it with a reason, logged', async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    const { id } = await submitKyc(owner.b);
    const assigned = await s.signedInStaff('operator');
    const other = await s.signedInStaff('operator');
    expect((await assigned.b.post(`/staff/kyc/submissions/${id}/claim`)).status).toBe(200);
    const why = 'Checking the photo against the selfie';
    expect([403, 409]).toContain((await other.b.post(`/staff/kyc/submissions/${id}/files/doc_front/view`, { reason: why })).status);
    expect((await assigned.b.post(`/staff/kyc/submissions/${id}/files/doc_front/view`, {})).status).toBe(400); // no reason, no view
    const r = await assigned.b.post(`/staff/kyc/submissions/${id}/files/doc_front/view`, { reason: why });
    expect(r.status).toBe(200);
    const { url } = (await r.json()) as { url: string };
    expect((await assigned.b.get(url.replace('/api/v1', ''))).status).toBe(200);
    expect((await other.b.get(url.replace('/api/v1', ''))).status).toBe(410); // the link is the viewer's own
    const views = await s.fx.query(
      `SELECT e.actor_id, e.reason FROM audit.events e JOIN identity.kyc_files f ON f.id = e.object_id WHERE e.action = 'kyc.file.viewed' AND f.submission_id = $1`, [id]);
    expect(views).toEqual([{ actor_id: assigned.s.staffId, reason: why }]);
  });

  it('SEC-ACC-06 an administrator never sees KYC images (FR-OPS-03)', async () => {
    const owner = await s.signedIn({ kyc: 'unsubmitted' });
    const { id } = await submitKyc(owner.b);
    const admin = await s.signedInStaff('administrator');
    expect((await admin.b.post(`/staff/kyc/submissions/${id}/files/doc_front/view`, { reason: 'Just looking at it now' })).status).toBe(403);
  });
});
