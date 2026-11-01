import { randomInt, randomUUID } from 'crypto';
import type { OutboxEvent } from '../../src/kernel/events/event-bus';
import { NotificationConsumers } from '../../src/modules/chat/consumers/notification.consumers';
import { NOTIFIER, Notifier } from '../../src/modules/chat/ports';
import { NotificationService } from '../../src/modules/chat/services/notification.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U6-04: notices from other units' events, the notification centre and preferences (docs/design/06_chat_notifications.pdf
// sections 3.1, 3.4 and 7), against PostgreSQL through the real security pipeline. Events are handed to the consumers
// as the outbox dispatcher would hand them; delivery of e-mail and SMS is U6-05's.
describe('notifications', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let consumers: NotificationConsumers;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    consumers = t.app.get(NotificationConsumers);
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const event = (type: string, payload: Record<string, unknown>, id = String(randomInt(1, 2 ** 31))): OutboxEvent =>
    ({ outbox: type.split('.')[0], id, type, aggregateId: String(payload.orderId ?? payload.userId ?? randomUUID()), payload, createdAt: new Date(), attempt: 1 });
  async function person() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `198.51.100.${randomInt(1, 255)}, 10.3.${randomInt(0, 255)}.${randomInt(1, 255)}`;
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method,
        headers: { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { userId, call };
  }
  const deliveries = (userId: string) =>
    fx.query<{ code: string; channel: string; status: string }>(
      `SELECT n.template_code AS code, d.channel, d.status FROM notify.notifications n JOIN notify.deliveries d ON d.notification_id = n.id WHERE n.user_id = $1 ORDER BY 1, 2`, [userId]);

  it('FR-NTF-06 a security event makes a notice by app, e-mail and SMS, once however often it is delivered', async () => {
    const u = await person();
    const e = event('identity.password.changed', { userId: u.userId, via: 'change' });
    await Promise.all(Array.from({ length: 10 }, () => consumers.handle(e)));
    await consumers.handle(e);
    expect(await fx.query(`SELECT template_code FROM notify.notifications WHERE user_id = $1`, [u.userId])).toEqual([{ template_code: 'security.password_changed' }]);
    expect(await deliveries(u.userId)).toEqual([
      { code: 'security.password_changed', channel: 'email', status: 'pending' }, { code: 'security.password_changed', channel: 'sms', status: 'pending' },
    ]);
  });

  it('FR-NTF-03 an order event notifies buyer and seller, names the order, and masks contact details in the title', async () => {
    const [buyer, seller] = [await person(), await person()];
    const orderId = randomUUID();
    await consumers.handle(event('orders.order.paid', { orderId, buyerId: buyer.userId, sellerId: seller.userId, total: '1500000', listingTitle: 'Phone, call 01711-234567' }));
    const view = await (await buyer.call('GET', '/notifications')).json();
    expect(view).toMatchObject({ unread: 1, nextCursor: null, items: [{ code: 'order.paid_buyer', subject: { type: 'order', id: orderId }, readAt: null }] });
    expect(view.items[0].body).toBe('"Phone, call [hidden]"-এর জন্য ৳১৫,০০০ পাওয়া গেছে। আপনি পণ্যটি হাতে না পাওয়া পর্যন্ত টাকাটি নিরাপদে রাখা হবে।');
    expect((await (await seller.call('GET', '/notifications')).json()).items.map((i: { code: string }) => i.code)).toEqual(['order.paid_seller']);
    expect(await deliveries(seller.userId)).toEqual([{ code: 'order.paid_seller', channel: 'email', status: 'pending' }]);
  });

  it('FR-NTF-05 the language and transactional e-mails are the user\'s choice; security e-mails cannot be turned off', async () => {
    const u = await person();
    expect(await (await u.call('GET', '/me/notification-preferences')).json()).toEqual({ language: 'bn', emailTransactional: true });
    const put = await u.call('PUT', '/me/notification-preferences', { language: 'en', emailTransactional: false });
    expect(await put.json()).toEqual({ language: 'en', emailTransactional: false });
    expect((await u.call('PUT', '/me/notification-preferences', { language: 'fr' })).status).toBe(400);
    const buyer = await person();
    await consumers.handle(event('orders.escrow.released', { orderId: randomUUID(), buyerId: buyer.userId, sellerId: u.userId, sellerPayout: '950000', listingTitle: 'Desk lamp' }));
    await consumers.handle(event('identity.mfa.disabled', { userId: u.userId }));
    expect(await deliveries(u.userId)).toEqual([
      { code: 'escrow.released_seller', channel: 'email', status: 'suppressed' },
      { code: 'security.mfa_disabled', channel: 'email', status: 'pending' }, { code: 'security.mfa_disabled', channel: 'sms', status: 'pending' },
    ]);
    const items = (await (await u.call('GET', '/notifications')).json()).items;
    expect(items.find((i: { code: string }) => i.code === 'escrow.released_seller').body).toBe('Tk 9,500 for "Desk lamp" was released to you and will be paid into your payout account.');
  });

  it('FR-NTF-04 the centre pages newest first and marks some or all as read', async () => {
    const u = await person();
    for (let i = 0; i < 53; i++) await consumers.handle(event('identity.kyc.verified', { userId: u.userId }, `kyc-${i}-${randomUUID()}`));
    const first = await (await u.call('GET', '/notifications')).json();
    expect([first.items.length, first.unread, typeof first.nextCursor]).toEqual([50, 53, 'string']);
    const second = await (await u.call('GET', `/notifications?cursor=${first.nextCursor}`)).json();
    expect([second.items.length, second.nextCursor]).toEqual([3, null]);
    expect(new Set([...first.items, ...second.items].map((i: { id: string }) => i.id)).size).toBe(53);
    expect((await u.call('GET', '/notifications?cursor=nonsense')).status).toBe(400);
    const r = await u.call('POST', '/notifications/read', { ids: [first.items[0].id, first.items[1].id] });
    expect(await r.json()).toEqual({ unread: 51 });
    expect(await (await u.call('POST', '/notifications/read', { all: true })).json()).toEqual({ unread: 0 });
    expect((await u.call('POST', '/notifications/read', {})).status).toBe(400);
  });

  it('FR-NTF-08 a parameter with contact details or a code is refused by the database, and an event without a recipient is retried', async () => {
    const u = await person();
    const notices = t.app.get(NotificationService);
    await expect(notices.create(u.userId, 'payment.refund_sent', { amount_bdt: 5, extra: 'x' }, 'k1')).rejects.toThrow(/not allowed/);
    await expect(t.app.get<Notifier>(NOTIFIER).notify(u.userId, 'payment.refund_sent', { amount_bdt: '01711234567' }, 'k2')).rejects.toThrow(/contact details/);
    await t.app.get<Notifier>(NOTIFIER).notify(u.userId, 'security.new_device', { device: 'call me on 01711234567' }, 'k3'); // user text is masked, not refused
    expect(await fx.query(`SELECT params FROM notify.notifications WHERE user_id = $1 AND dedupe_key = 'k3'`, [u.userId])).toEqual([{ params: { device: 'call me on [hidden]' } }]);
    await expect(consumers.handle(event('orders.order.paid', { orderId: randomUUID(), total: '1' }))).rejects.toThrow(/no recipient/);
    expect(await consumers.handle(event('orders.order.cancelled', { orderId: randomUUID(), buyerId: u.userId, reason: 'listing_withdrawn' }))).toBe(0);
  });

  it('SEC-SDL-09 a user sees and marks only their own notices; no session, no centre', async () => {
    const [a, b] = [await person(), await person()];
    await consumers.handle(event('identity.kyc.verified', { userId: a.userId }));
    const [mine] = (await (await a.call('GET', '/notifications')).json()).items;
    expect((await (await b.call('GET', '/notifications')).json()).items).toEqual([]);
    await b.call('POST', '/notifications/read', { ids: [mine.id] });
    expect((await (await a.call('GET', '/notifications')).json()).items[0].readAt).toBeNull();
    expect((await fetch(t.url('/notifications'))).status).toBe(401);
    expect((await fetch(t.url('/me/notification-preferences'))).status).toBe(401);
  });

  it('FR-NTF-03 every event the consumers know maps to an active template', async () => {
    const codes = new Set((await fx.query<{ code: string }>(`SELECT code FROM notify.templates WHERE active`)).map((r) => r.code));
    const u = randomUUID();
    const p = { userId: u, buyerId: u, sellerId: u, orderId: u, kind: 'auction', reason: 'checkout_expired', decision: 'approve', total: '1', amount: '1', refunded: '1', sellerPayout: '1', listingTitle: 't', listingId: u };
    for (const [type, map] of Object.entries(consumers.map)) {
      if (type === 'listings.listing.published') continue; // reads the listing through ListingsPort
      for (const n of await map(event(type, p))) expect([type, codes.has(n.code)]).toEqual([type, true]);
    }
  });
});
