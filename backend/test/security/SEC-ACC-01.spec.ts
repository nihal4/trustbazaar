import { Controller, Get } from '@nestjs/common';
import { routeName, routesOf } from '../support/routes';
import { suite } from './setup';

// SEC-ACC-01: every request is authorised on the server, with access denied by default; hiding a control in the web
// client never counts as access control.
/** A test-only route that forgot to declare who may call it. */
@Controller('test-acc-01')
class Undeclared {
  @Get()
  open() {
    return { leaked: true };
  }
}
const s = suite([Undeclared]);

describe('SEC-ACC-01 deny by default', () => {
  it('SEC-ACC-01 every route of the backend declares its policy (the test-only one excepted)', () => {
    expect(routesOf(s.t.app).filter((r) => !r.policy && !r.path.includes('test-acc-01')).map(routeName)).toEqual([]);
  });

  it('SEC-ACC-01 a route without a policy is refused to everyone, signed in or not', async () => {
    const anon = await fetch(s.t.url('/test-acc-01'));
    expect(anon.status).toBe(403);
    expect(await anon.text()).not.toContain('leaked');
    const userId = await s.fx.user({ kyc: 'verified' });
    const sid = await s.fx.session({ userId });
    expect((await fetch(s.t.url('/test-acc-01'), { headers: s.fx.headers(sid, userId, 'user') })).status).toBe(403);
  });

  it('SEC-ACC-01 actions the web client hides from a member are refused by the server when called directly', async () => {
    const { b } = await s.signedIn({ kyc: 'unsubmitted' });
    // the client shows no "Sell" or "Bid" to an unverified member, and no console at all
    expect((await b.post('/listings', { itemKind: 'physical', saleFormat: 'fixed_price', title: 'Hidden button' })).status).toBe(403);
    expect((await b.get('/staff/me')).status).toBe(401);
    expect((await b.get('/staff/kyc/queue')).status).toBe(401);
    expect((await b.get('/admin/config')).status).toBe(401);
  });
});
