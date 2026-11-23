import { Controller, Get } from '@nestjs/common';
import { startApp } from '../support/app';
import { routeName, routesOf } from '../support/routes';
import { suite } from './setup';

// SEC-ACC-01: every request is authorised on the server, with access denied by default; hiding a control in the web
// client never counts as access control.
const s = suite();

/** A test-only route that forgot to declare who may call it. */
@Controller('test-acc-01')
class Undeclared {
  @Get()
  open() {
    return { leaked: true };
  }
}

describe('SEC-ACC-01 deny by default', () => {
  it('SEC-ACC-01 every route of the backend declares its policy', () => {
    expect(routesOf(s.t.app).filter((r) => !r.policy).map(routeName)).toEqual([]);
  });

  it('SEC-ACC-01 a route without a policy is refused to everyone, signed in or not', async () => {
    const t = await startApp([Undeclared]);
    try {
      const anon = await fetch(t.url('/test-acc-01'));
      expect(anon.status).toBe(403);
      expect(await anon.text()).not.toContain('leaked');
      const { headers } = await (async () => {
        const userId = await s.fx.user({ kyc: 'verified' });
        const sid = await s.fx.session({ userId });
        return { headers: s.fx.headers(sid, userId, 'user') };
      })();
      expect((await fetch(t.url('/test-acc-01'), { headers })).status).toBe(403);
    } finally {
      await t.close();
    }
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
