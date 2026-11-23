import { suite } from './setup';

// SEC-ACC-03: the roles Guest, Registered user, Verified user, Pro Seller, Operator and Administrator have the
// permissions of the SRS and no others, checked on the server for every protected action.
const s = suite();

describe('SEC-ACC-03 roles', () => {
  const sell = { itemKind: 'physical', saleFormat: 'fixed_price', title: 'A role test item' };

  it('SEC-ACC-03 a guest browses and searches, and cannot buy, sell or see an account', async () => {
    const g = s.browser();
    expect((await g.get('/search?q=lamp')).status).toBe(200);
    expect((await g.get('/categories')).status).toBe(200);
    expect((await g.post('/listings', sell)).status).toBe(401);
    expect((await g.post('/orders', { listingId: '00000000-0000-4000-8000-000000000000', quantity: 1, fulfilment: 'self_pickup' })).status).toBe(401);
    expect((await g.get('/me')).status).toBe(401);
  });

  it('SEC-ACC-03 a registered member manages their account, and cannot sell or bid until verified', async () => {
    const { b } = await s.signedIn({ kyc: 'unsubmitted' });
    expect((await b.get('/me')).status).toBe(200);
    expect((await b.get('/kyc/status')).status).toBe(200);
    expect((await b.post('/listings', sell)).status).toBe(403);
    expect((await b.post('/auctions/00000000-0000-4000-8000-000000000000/bids', { maximum: '100000' })).status).toBe(403);
  });

  it('SEC-ACC-03 a verified member may sell (and has no staff power)', async () => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    expect((await b.post('/listings', sell)).status).not.toBe(403);
    expect((await b.get('/staff/me')).status).toBe(401);
  });

  it('SEC-ACC-03 an operator works the queues and cannot change parameters or staff accounts; an administrator can, and never sees KYC documents', async () => {
    const op = await s.signedInStaff('operator');
    expect((await op.b.get('/staff/kyc/queue')).status).toBe(200);
    expect((await op.b.get('/admin/staff')).status).toBe(403);
    expect((await op.b.get('/admin/audit')).status).toBe(403);
    expect((await op.b.get('/admin/config')).status).toBe(403);
    const admin = await s.signedInStaff('administrator');
    expect((await admin.b.get('/admin/staff')).status).toBe(200);
    expect((await admin.b.get('/admin/config')).status).toBe(200);
    expect((await admin.b.get('/staff/kyc/queue')).status).toBe(403); // FR-OPS-03
    // and neither staff role acts as a member
    expect((await admin.b.get('/me')).status).toBe(401);
    expect((await op.b.get('/me')).status).toBe(401);
  });
});
