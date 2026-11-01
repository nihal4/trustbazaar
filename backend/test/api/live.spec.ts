import { randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';
import { loadConfig } from '../../src/kernel/config/config';
import { LIVE, LivePort } from '../../src/kernel/live/live';
import { LiveGateway } from '../../src/kernel/live/live.gateway';
import { NotificationConsumers } from '../../src/modules/chat/consumers/notification.consumers';
import { SessionService } from '../../src/modules/identity/services/session.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// K-07: the live connection (SEC-SES-07, IF-COM-01, I-51 d, NFR-SCL-01) with a real Socket.IO client against the
// test server, through Unit 1's session check, with rooms shared over Redis.
describe('live connection', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  const open: Socket[] = [];

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
  });
  afterAll(async () => {
    for (const s of open) s.disconnect();
    await fx?.close();
    await t?.close();
  });

  const base = (app: TestApp) => new URL(app.url('/')).origin;
  /** A client; resolves once connected, or rejects with the handshake error's message. */
  function connect(headers: Record<string, string>, app: TestApp = t): Promise<Socket> {
    const s = io(base(app), { path: '/socket.io', transports: ['websocket'], extraHeaders: headers, reconnection: false, forceNew: true });
    open.push(s);
    return new Promise((resolve, reject) => {
      s.once('connect', () => resolve(s));
      s.once('connect_error', (e) => reject(e));
    });
  }
  const refused = (headers: Record<string, string>) => connect(headers).then(() => 'connected', (e: Error) => e.message);
  async function person() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const { cookie } = fx.headers(sid, userId, 'user');
    return { userId, sid, headers: { cookie, origin } };
  }
  /** The next `event` on the socket, or 'none' after `ms`. */
  const next = (s: Socket, event: string, ms = 1500) =>
    new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => resolve('none'), ms);
      s.once(event, (p: unknown) => {
        clearTimeout(timer);
        resolve(p);
      });
    });
  const closed = (s: Socket, ms = 3000) =>
    new Promise<string>((resolve) => {
      if (!s.connected) return resolve('closed');
      const timer = setTimeout(() => resolve('open'), ms);
      s.once('disconnect', () => {
        clearTimeout(timer);
        resolve('closed');
      });
    });

  it('SEC-SES-07 a connection is authenticated when it opens; the user gets their own messages only', async () => {
    const [a, b] = [await person(), await person()];
    const [sa, sb] = [await connect(a.headers), await connect(b.headers)];
    const live = t.app.get<LivePort>(LIVE);
    const got = [next(sa, 'ping.test'), next(sb, 'ping.test', 700)];
    live.toUser(a.userId, 'ping.test', { n: 1 });
    expect(await Promise.all(got)).toEqual([{ n: 1 }, 'none']);
  });

  it('I-51 a missing or ended session is refused as session-ended; an expired token as token-expired', async () => {
    expect(await refused({ origin })).toBe('session-ended');
    const u = await person();
    const expired = fx.headers(u.sid, u.userId, 'user', { ttlSeconds: -60 }).cookie;
    expect(await refused({ cookie: expired, origin })).toBe('token-expired');
    const forged = u.headers.cookie.replace(/\.[^.;]+;/, '.AAAA;');
    expect(await refused({ cookie: forged, origin })).toBe('session-ended');
    await fx.query(`UPDATE identity.sessions SET ended_at = now(), end_reason = 'logout' WHERE id = $1`, [u.sid]);
    expect(await refused(u.headers)).toBe('session-ended');
    const staffId = await fx.staff('operator');
    const staffSid = await fx.session({ staffId });
    expect(await refused({ cookie: fx.headers(staffSid, staffId, 'staff').cookie, origin })).toBe('session-ended');
  });

  it('SEC-SES-07 a page on another site cannot open a connection with our cookies', async () => {
    const u = await person();
    expect(await refused({ cookie: u.headers.cookie, origin: 'https://evil.example' })).not.toBe('connected');
    expect(await refused({ cookie: u.headers.cookie })).not.toBe('connected');
  });

  it('SEC-SES-07 the client may join auction rooms only, and a limited number', async () => {
    const u = await person();
    const s = await connect(u.headers);
    const listing = randomUUID();
    expect(await s.emitWithAck('join', { room: `auction:${listing}` })).toEqual({ ok: true });
    const other = await person();
    for (const room of [`user:${other.userId}`, `sid:${other.sid}`, 'auction:not-a-uuid', `auction:${listing} `]) {
      expect(await s.emitWithAck('join', { room })).toEqual({ ok: false, error: 'room-not-allowed' });
    }
    const got = next(s, 'auction.state');
    t.app.get<LivePort>(LIVE).toRoom(`auction:${listing}`, 'auction.state', { seq: 7 });
    expect(await got).toEqual({ seq: 7 });
    expect(await s.emitWithAck('leave', { room: `auction:${listing}` })).toEqual({ ok: true });
    const after = next(s, 'auction.state', 700);
    t.app.get<LivePort>(LIVE).toRoom(`auction:${listing}`, 'auction.state', { seq: 8 });
    expect(await after).toBe('none');
    for (let i = 0; i < 20; i++) await s.emitWithAck('join', { room: `auction:${randomUUID()}` });
    expect(await s.emitWithAck('join', { room: `auction:${randomUUID()}` })).toEqual({ ok: false, error: 'too-many-rooms' });
    const sneaky = next(s, 'ping.test', 700);
    t.app.get<LivePort>(LIVE).toUser(other.userId, 'ping.test', {});
    expect(await sneaky).toBe('none');
  });

  it('SEC-SES-05 signing out closes the session\'s connections at once', async () => {
    const u = await person();
    const s = await connect(u.headers);
    const r = await fetch(t.url('/auth/signout'), { method: 'POST', headers: fx.headers(u.sid, u.userId, 'user') });
    expect(r.status).toBe(204);
    expect(await closed(s)).toBe('closed');
  });

  it('SEC-SES-07 sessions ended inside a transaction close their connections after the commit', async () => {
    const u = await person();
    const otherSid = await fx.session({ userId: u.userId });
    const keep = await connect(u.headers);
    const other = await connect({ cookie: fx.headers(otherSid, u.userId, 'user').cookie, origin });
    await t.app.get(SessionService).endOthers(u.userId, u.sid, { ip: null, userAgent: null, correlationId: null });
    expect(await closed(other)).toBe('closed');
    expect(keep.connected).toBe(true);
  });

  it('SEC-SES-07 the periodic re-check closes connections whose session ended any other way', async () => {
    const u = await person();
    const s = await connect(u.headers);
    await fx.query(`UPDATE identity.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1`, [u.sid]);
    expect(await t.app.get(LiveGateway).recheck()).toBeGreaterThanOrEqual(1);
    expect(await closed(s)).toBe('closed');
  });

  it('IF-COM-01 a new notification is pushed with its title, unread count and subject (I-55)', async () => {
    const u = await person();
    const s = await connect(u.headers);
    const got = next(s, 'notification.new');
    const orderId = randomUUID();
    const seller = await fx.user();
    await t.app.get(NotificationConsumers).handle({
      outbox: 'orders', id: randomUUID(), type: 'orders.order.paid', aggregateId: orderId, createdAt: new Date(), attempt: 1,
      payload: { orderId, buyerId: u.userId, sellerId: seller, total: '250000', listingTitle: 'Lamp' },
    });
    expect(await got).toEqual({ id: expect.any(String), title: 'পেমেন্ট গৃহীত হয়েছে', unread: 1, subject: { type: 'order', id: orderId } });
  });

  it('NFR-SCL-01 a message reaches a user connected to another backend instance', async () => {
    const second = await startApp();
    try {
      const u = await person();
      const s = await connect(u.headers, second);
      const got = next(s, 'ping.test', 3000);
      t.app.get<LivePort>(LIVE).toUser(u.userId, 'ping.test', { from: 'the first instance' });
      expect(await got).toEqual({ from: 'the first instance' });
    } finally {
      await second.close();
    }
  });
});
