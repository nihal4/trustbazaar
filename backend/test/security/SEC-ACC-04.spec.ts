import { randomUUID } from 'crypto';
import { draftListing, problem, suite } from './setup';

// SEC-ACC-04: request bodies are accepted only with the fields the endpoint allows; role, KYC status, price after
// bidding, escrow state or seller payout are never settable from client input.
const s = suite();

describe('SEC-ACC-04 no mass assignment', () => {
  const refusedFor = async (r: Response, field: string) => {
    const p = await problem(r);
    expect(p.status).toBe(400);
    expect(JSON.stringify(p.errors)).toContain(field);
  };

  it('SEC-ACC-04 registration refuses a role or a KYC status in the body', async () => {
    const base = { email: `m-${randomUUID()}@tb.test`, displayName: 'Nadia Islam', password: 'paper boats on a slow river' };
    await refusedFor(await s.browser().post('/auth/register', { ...base, role: 'administrator' }), 'role');
    await refusedFor(await s.browser().post('/auth/register', { ...base, kycStatus: 'verified' }), 'kycStatus');
  });

  it('SEC-ACC-04 an order refuses a price, a total or an escrow state from the buyer', async () => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    const order = { listingId: randomUUID(), quantity: 1, fulfilment: 'self_pickup' };
    await refusedFor(await b.post('/orders', { ...order, total: '100' }), 'total');
    await refusedFor(await b.post('/orders', { ...order, unitPrice: '100' }), 'unitPrice');
    await refusedFor(await b.post('/orders', { ...order, escrowState: 'released' }), 'escrowState');
  });

  it('SEC-ACC-04 a listing edit refuses its status, seller or a price set after bidding', async () => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    const id = await draftListing(s, b);
    await refusedFor(await b.request('PATCH', `/listings/${id}`, { status: 'active' }), 'status');
    await refusedFor(await b.request('PATCH', `/listings/${id}`, { sellerId: randomUUID() }), 'sellerId');
    await refusedFor(await b.request('PATCH', `/listings/${id}`, { currentPrice: '1' }), 'currentPrice');
    const [l] = await s.fx.query(`SELECT status FROM listings.listings WHERE id = $1`, [id]);
    expect(l.status).toBe('draft');
  });

  it('SEC-ACC-04 a payout account refuses an approval state or a payout amount from the seller', async () => {
    const { a, b } = await s.signedIn({ kyc: 'verified' });
    const [{ id: sid }] = await s.fx.query<{ id: string }>(`SELECT id FROM identity.sessions WHERE user_id = $1 AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1`, [a.userId]);
    const stepped = async (body: object) => b.post('/me/payout-account', body, { 'x-step-up': await s.fx.stepUpGrant(sid, 'payout.change') });
    await refusedFor(await stepped({ method: 'bkash', accountName: 'Nadia Islam', accountNumber: '01711000000', status: 'approved' }), 'status');
    await refusedFor(await stepped({ method: 'bkash', accountName: 'Nadia Islam', accountNumber: '01711000000', payoutAmount: '1' }), 'payoutAmount');
  });

  it('SEC-ACC-04 an error names the refused field, never echoes its value', async () => {
    const { b } = await s.signedIn({ kyc: 'verified' });
    const r = await b.post('/orders', { listingId: randomUUID(), quantity: 1, fulfilment: 'self_pickup', role: 'administrator-0xSECRETVALUE' });
    expect(await r.text()).not.toContain('0xSECRETVALUE');
  });
});
