import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { randomInt } from 'crypto';
import {
  Credential, POLICY_KEY, Public, RateLimit, SignedIn, Staff, StepUp, Verified,
} from '../../src/kernel/http/policies';
import { CurrentPrincipal, Principal } from '../../src/kernel/http/principal';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// The security pipeline of Unit 1 section 4.1 (U1-02), end to end over HTTP against PostgreSQL and Redis.
// A test-only controller offers one route per policy; the real guards protect it like any other route.
@Controller('test-pipeline')
class ProbeController {
  @Get('no-policy')
  noPolicy() {
    return { reached: true };
  }

  @Public()
  @Get('public')
  open(@CurrentPrincipal() p?: Principal) {
    return { principal: p?.type ?? null };
  }

  @SignedIn()
  @Get('signed-in')
  signedIn(@CurrentPrincipal() p: Principal) {
    return { userId: p.type === 'user' ? p.userId : null };
  }

  @SignedIn()
  @Post('signed-in')
  @HttpCode(200)
  change() {
    return { changed: true };
  }

  @Verified('bid')
  @Get('verified-bid')
  bid() {
    return { ok: true };
  }

  @Staff('administrator')
  @Get('staff-admin')
  admin() {
    return { ok: true };
  }

  @Staff()
  @Get('staff-any')
  anyStaff() {
    return { ok: true };
  }

  @SignedIn()
  @StepUp('account.close')
  @Post('step-up')
  @HttpCode(200)
  sensitive() {
    return { ok: true };
  }

  @Public()
  @RateLimit('search')
  @Get('limited')
  limited() {
    return { ok: true };
  }

  @Credential('provider-signature')
  @Post('webhook')
  @HttpCode(200)
  webhook() {
    return { ok: true };
  }

  @Public()
  @Get('boom')
  boom() {
    throw new Error('connection to 10.0.0.5 failed for tb_app');
  }
}

const ip = () => `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;

describe('security pipeline', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  const call = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    fetch(t.url(`/test-pipeline/${path}`), init);
  const json = async (r: Response) => ({ status: r.status, body: await r.json() });

  beforeAll(async () => {
    t = await startApp([ProbeController]);
    fx = await IdentityFixtures.open();
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function userHeaders(o: Parameters<IdentityFixtures['user']>[0] = {}, s: Parameters<IdentityFixtures['session']>[1] = {}) {
    const userId = await fx.user(o);
    const sid = await fx.session({ userId }, s);
    return { userId, sid, headers: fx.headers(sid, userId, 'user') };
  }

  async function staffHeaders(role: 'operator' | 'administrator', status?: 'active' | 'disabled') {
    const staffId = await fx.staff(role, status);
    const sid = await fx.session({ staffId });
    return { staffId, sid, headers: fx.headers(sid, staffId, 'staff') };
  }

  describe('policies (DC-7)', () => {
    it('DC-7 a route without a policy cannot be reached', async () => {
      const { headers } = await userHeaders();
      expect(await json(await call('no-policy', { headers }))).toMatchObject({ status: 403, body: { type: '/problems/forbidden' } });
    });

    it('DC-7 every route of the application declares a policy', () => {
      const discovery = t.app.get(DiscoveryService);
      const scanner = t.app.get(MetadataScanner);
      const reflector = t.app.get(Reflector);
      const missing: string[] = [];
      for (const wrapper of discovery.getControllers()) {
        const cls = wrapper.metatype as (new (...a: unknown[]) => unknown) | undefined;
        if (!cls || cls === ProbeController) continue;
        for (const name of scanner.getAllMethodNames(cls.prototype)) {
          const handler = (cls.prototype as Record<string, (...a: unknown[]) => unknown>)[name];
          if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
          if (!reflector.getAllAndOverride(POLICY_KEY, [handler, cls])) {
            missing.push(`${cls.name}.${name} ${Reflect.getMetadata(PATH_METADATA, handler)}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });

    it('SEC-SES-01 a public route serves guests, and knows a signed-in user', async () => {
      expect((await json(await call('public'))).body).toEqual({ principal: null });
      const { headers } = await userHeaders();
      expect((await json(await call('public', { headers }))).body).toEqual({ principal: 'user' });
      expect((await json(await call('public', { headers: { cookie: '__Host-tb_at=not-a-token' } }))).body).toEqual({ principal: null });
    });
  });

  describe('sessions (SEC-SDL-09)', () => {
    it.each(['signed-in', 'verified-bid', 'staff-admin', 'staff-any'])('SEC-SDL-09 no session: %s answers 401', async (path) => {
      expect(await json(await call(path))).toMatchObject({ status: 401, body: { type: '/problems/session-ended' } });
    });

    it.each([
      ['past its idle limit', { idleSeconds: -1 }],
      ['past its absolute limit', { idleSeconds: -5, absoluteSeconds: -1 }],
      ['ended (signed out)', { ended: true }],
    ])('SEC-SES-05 a session %s is refused on its next request', async (_case, s) => {
      const { headers } = await userHeaders({}, s);
      expect((await call('signed-in', { headers })).status).toBe(401);
    });

    it('SEC-SDL-09 an expired access token answers 401, so the client refreshes', async () => {
      const userId = await fx.user();
      const sid = await fx.session({ userId });
      const headers = fx.headers(sid, userId, 'user', { ttlSeconds: -10 });
      expect((await call('signed-in', { headers })).status).toBe(401);
    });

    it('SEC-SES-05 the session of a closed account is refused', async () => {
      const { headers } = await userHeaders({ status: 'closed' });
      expect((await call('signed-in', { headers })).status).toBe(401);
    });

    it('SEC-SES-05 the session of a disabled staff account is refused', async () => {
      const { headers } = await staffHeaders('administrator', 'disabled');
      expect((await call('staff-any', { headers })).status).toBe(401);
    });

    it('SEC-SES-01 a token naming another user\'s session is refused', async () => {
      const a = await userHeaders();
      const b = await fx.user();
      const forged = fx.headers(a.sid, b, 'user');
      expect((await call('signed-in', { headers: forged })).status).toBe(401);
    });

    it('SEC-SES-05 a session in use has last_seen_at brought up to date', async () => {
      const { sid, headers } = await userHeaders();
      const before = await fx.lastSeen(sid);
      expect((await call('signed-in', { headers })).status).toBe(200);
      expect((await fx.lastSeen(sid)).getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe('roles (SEC-SDL-09)', () => {
    it('SEC-SDL-09 a lower role is refused: an operator on an administrator route answers 403', async () => {
      const { headers } = await staffHeaders('operator');
      expect(await json(await call('staff-admin', { headers }))).toMatchObject({ status: 403, body: { type: '/problems/forbidden' } });
      expect((await call('staff-any', { headers })).status).toBe(200);
    });

    it('SEC-SDL-09 an administrator reaches the administrator route', async () => {
      const { headers } = await staffHeaders('administrator');
      expect((await call('staff-admin', { headers })).status).toBe(200);
    });

    it('SEC-SDL-09 a user session never reaches a staff route, and a staff session never a user route (I-51)', async () => {
      const user = await userHeaders();
      const staff = await staffHeaders('administrator');
      expect((await call('staff-any', { headers: user.headers })).status).toBe(401);
      expect((await call('signed-in', { headers: staff.headers })).status).toBe(401);
    });
  });

  describe('the KYC gate (FR-KYC-07)', () => {
    it.each(['unsubmitted', 'pending_review', 'rejected', 'revoked'])(
      'FR-KYC-07 a user whose KYC is %s is refused by @Verified',
      async (kyc) => {
        const { headers } = await userHeaders({ kyc });
        expect((await call('verified-bid', { headers })).status).toBe(403);
      },
    );

    it('FR-KYC-07 a verified user without a verified e-mail is refused', async () => {
      const { headers } = await userHeaders({ emailVerified: false });
      expect((await call('verified-bid', { headers })).status).toBe(403);
    });

    it('FR-KYC-07 a verified user with a verified e-mail and an active account passes', async () => {
      const { headers } = await userHeaders();
      expect((await call('verified-bid', { headers })).status).toBe(200);
    });

    it('FR-TNS-05 a suspended user can still sign in and use their account, but cannot transact', async () => {
      const { headers } = await userHeaders({ status: 'suspended' });
      expect((await call('signed-in', { headers })).status).toBe(200);
      expect((await call('verified-bid', { headers })).status).toBe(403);
    });
  });

  describe('CSRF (SEC-SES-04)', () => {
    it('SEC-SES-04 a state-changing request with the session\'s token from the site\'s origin passes', async () => {
      const { headers } = await userHeaders();
      expect((await call('signed-in', { method: 'POST', headers })).status).toBe(200);
    });

    it.each([
      ['without Origin', (h: Record<string, string>) => ({ ...h, origin: '' })],
      ['from another origin', (h: Record<string, string>) => ({ ...h, origin: 'https://evil.example' })],
      ['without X-CSRF-Token', (h: Record<string, string>) => ({ ...h, 'x-csrf-token': '' })],
      ['with a token that differs from the cookie', (h: Record<string, string>) => ({ ...h, 'x-csrf-token': 'forged' })],
    ])('SEC-SES-04 a state-changing request %s is refused', async (_case, alter) => {
      const { headers } = await userHeaders();
      const r = await json(await call('signed-in', { method: 'POST', headers: alter(headers) }));
      expect(r).toMatchObject({ status: 403, body: { type: '/problems/csrf-failed' } });
    });

    it('SEC-SES-04 the CSRF token of another session is refused', async () => {
      const a = await userHeaders();
      const b = await userHeaders();
      const mixed: Record<string, string> = { ...a.headers, 'x-csrf-token': b.headers['x-csrf-token'] };
      mixed.cookie = a.headers.cookie.replace(/__Host-tb_csrf=[^;]+/, `__Host-tb_csrf=${b.headers['x-csrf-token']}`);
      expect((await call('signed-in', { method: 'POST', headers: mixed })).status).toBe(403);
    });

    it('SEC-SES-04 a provider webhook needs no Origin: its own signature protects it', async () => {
      expect((await call('webhook', { method: 'POST' })).status).toBe(200);
    });
  });

  describe('step-up (SEC-AUTH-08)', () => {
    it('SEC-AUTH-08 without a grant the answer is 403 step-up-required', async () => {
      const { headers } = await userHeaders();
      const r = await json(await call('step-up', { method: 'POST', headers }));
      expect(r).toMatchObject({ status: 403, body: { type: '/problems/step-up-required' } });
    });

    it('SEC-AUTH-08 a grant works once, for its action, in its session', async () => {
      const { sid, headers } = await userHeaders();
      const grant = await fx.stepUpGrant(sid, 'account.close');
      expect((await call('step-up', { method: 'POST', headers: { ...headers, 'x-step-up': grant } })).status).toBe(200);
      expect((await call('step-up', { method: 'POST', headers: { ...headers, 'x-step-up': grant } })).status).toBe(403);
    });

    it('SEC-AUTH-08 a grant for another action, or of another session, is refused', async () => {
      const a = await userHeaders();
      const b = await userHeaders();
      const otherAction = await fx.stepUpGrant(a.sid, 'password.change');
      const otherSession = await fx.stepUpGrant(b.sid, 'account.close');
      expect((await call('step-up', { method: 'POST', headers: { ...a.headers, 'x-step-up': otherAction } })).status).toBe(403);
      expect((await call('step-up', { method: 'POST', headers: { ...a.headers, 'x-step-up': otherSession } })).status).toBe(403);
    });
  });

  describe('rate limits (SEC-ABU-01)', () => {
    it('SEC-ABU-01 the 61st request in a minute from one address answers 429 with Retry-After', async () => {
      const headers = { 'x-forwarded-for': ip() };
      for (let i = 0; i < 60; i++) expect((await call('limited', { headers })).status).toBe(200);
      const r = await call('limited', { headers });
      expect(r.status).toBe(429);
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await call('limited', { headers: { 'x-forwarded-for': ip() } })).status).toBe(200); // another address
    });

    it('SEC-ABU-01 the limit holds across two backend instances', async () => {
      const second = await startApp([ProbeController]);
      try {
        const headers = { 'x-forwarded-for': ip() };
        for (let i = 0; i < 60; i++) {
          const url = i % 2 === 0 ? t.url('/test-pipeline/limited') : second.url('/test-pipeline/limited');
          expect((await fetch(url, { headers })).status).toBe(200);
        }
        expect((await fetch(second.url('/test-pipeline/limited'), { headers })).status).toBe(429);
      } finally {
        await second.close();
      }
    });
  });

  describe('errors (SEC-INP-06)', () => {
    it('SEC-INP-06 an error is a problem document whose correlation id matches the response header', async () => {
      const r = await call('signed-in');
      expect(r.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      const body = await r.json();
      expect(body.correlationId).toBe(r.headers.get('x-correlation-id'));
      expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('SEC-INP-06 an unexpected failure answers 500 without its details', async () => {
      const r = await json(await call('boom'));
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.body)).not.toMatch(/10\.0\.0\.5|tb_app/);
    });
  });
});
