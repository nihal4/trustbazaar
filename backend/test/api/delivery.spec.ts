import { randomInt, randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS } from '../../src/kernel/redis.provider';
import { EMAIL_ADAPTER, EmailAdapter } from '../../src/modules/chat/adapters/channels';
import { DEV_MAILBOX_KEY, DevMailbox } from '../../src/modules/chat/adapters/dev-mailbox';
import { NotificationConsumers } from '../../src/modules/chat/consumers/notification.consumers';
import { NOTIFICATION_PORT, NotificationPort } from '../../src/modules/chat/ports';
import { DeliveryService, MAX_ATTEMPTS, RETRY_MINUTES } from '../../src/modules/chat/services/delivery.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// U6-05: the e-mail and SMS adapters in log mode, NotificationPort for Unit 1, the delivery worker, the development
// mailbox and retention (docs/design/06_chat_notifications.pdf sections 7.2 and 8; DV-42, DV-43; I-36), against
// PostgreSQL and Redis.
describe('delivery of e-mail and SMS', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let worker: DeliveryService;
  let mailbox: DevMailbox;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    worker = t.app.get(DeliveryService);
    mailbox = new DevMailbox(t.app.get<Redis>(REDIS));
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  const event = (type: string, payload: Record<string, unknown>) =>
    ({ outbox: type.split('.')[0], id: randomUUID(), type, aggregateId: String(payload.userId ?? randomUUID()), payload, createdAt: new Date(), attempt: 1 });
  const drain = async () => { for (let i = 0; i < 40 && (await worker.processDue()) > 0; i++); }; // other test files leave due rows too
  async function user(o: { emailVerified?: boolean; language?: 'bn' | 'en' } = {}) {
    const userId = await fx.user({ emailVerified: o.emailVerified ?? true });
    if (o.language) await fx.query(`INSERT INTO notify.preferences (user_id, language) VALUES ($1, $2)`, [userId, o.language]);
    const [u] = await fx.query<{ phone_e164: string; email: string }>(`SELECT phone_e164, email FROM identity.users WHERE id = $1`, [userId]);
    return { userId, phone: u.phone_e164, email: u.email };
  }
  const statusOf = (userId: string) =>
    fx.query<{ channel: string; status: string; attempts: number; last_error: string | null }>(
      `SELECT d.channel, d.status, d.attempts, d.last_error FROM notify.deliveries d JOIN notify.notifications n ON n.id = d.notification_id WHERE n.user_id = $1 ORDER BY 1`, [userId]);

  it('FR-NTF-06 a security notice is sent by e-mail and SMS to the current contact, in the user\'s language', async () => {
    const u = await user({ language: 'en' });
    await t.app.get(NotificationConsumers).handle(event('identity.password.changed', { userId: u.userId }));
    await drain();
    expect(await statusOf(u.userId)).toEqual([
      { channel: 'email', status: 'sent', attempts: 1, last_error: null }, { channel: 'sms', status: 'sent', attempts: 1, last_error: null },
    ]);
    const [email] = await mailbox.list(u.email);
    expect(email).toMatchObject({ channel: 'email', subject: 'Your password was changed', simulated: true });
    const [sms] = await mailbox.list(u.phone);
    expect(sms.text).toMatch(/^Your password was changed: The password of your TrustBazaar account was changed/);
    const logs = await fx.query<{ purpose: string; simulated: boolean }>(`SELECT purpose, simulated FROM notify.sms_log WHERE phone_hmac = $1`, [
      (t.app.get<NotificationPort & { phoneHmac(p: string): Buffer }>(NOTIFICATION_PORT)).phoneHmac(u.phone),
    ]);
    expect(logs).toEqual([{ purpose: 'security_notice', simulated: true }]);
  });

  it('I-36 a changed contact applies at once; no verified address means the e-mail is suppressed', async () => {
    const u = await user({ emailVerified: false });
    await t.app.get(NotificationConsumers).handle(event('identity.kyc.verified', { userId: u.userId }));
    await drain();
    expect(await statusOf(u.userId)).toEqual([{ channel: 'email', status: 'suppressed', attempts: 1, last_error: 'no-address' }]);
    expect(await mailbox.list(u.email)).toEqual([]);
  });

  it('DV-43 a failed send is retried on the schedule, six attempts, then stays failed', async () => {
    const u = await user();
    const email = t.app.get<EmailAdapter>(EMAIL_ADAPTER);
    const spy = jest.spyOn(email, 'send').mockRejectedValue(Object.assign(new Error('smtp 421'), { code: 'EPROVIDER' }));
    worker.random = () => 0;
    try {
      await t.app.get(NotificationConsumers).handle(event('identity.kyc.verified', { userId: u.userId }));
      await drain();
      const [first] = await fx.query<{ status: string; attempts: number; last_error: string; delay_min: number }>(
        `SELECT d.status, d.attempts, d.last_error, round(extract(epoch FROM d.next_attempt_at - now()) / 60)::int AS delay_min
           FROM notify.deliveries d JOIN notify.notifications n ON n.id = d.notification_id WHERE n.user_id = $1`, [u.userId]);
      expect(first).toEqual({ status: 'failed', attempts: 1, last_error: 'EPROVIDER', delay_min: RETRY_MINUTES[0] });
      for (let i = 2; i <= MAX_ATTEMPTS + 1; i++) {
        await fx.query(`UPDATE notify.deliveries d SET next_attempt_at = now() FROM notify.notifications n WHERE n.id = d.notification_id AND n.user_id = $1`, [u.userId]);
        await drain();
      }
      expect(await statusOf(u.userId)).toEqual([{ channel: 'email', status: 'failed', attempts: MAX_ATTEMPTS, last_error: 'EPROVIDER' }]);
    } finally {
      spy.mockRestore();
      worker.random = Math.random;
    }
  });

  it('NFR-REL-03 five workers at once send each message exactly once', async () => {
    const users = await Promise.all(Array.from({ length: 12 }, () => user()));
    for (const u of users) await t.app.get(NotificationConsumers).handle(event('identity.mfa.enabled', { userId: u.userId }));
    await Promise.all(Array.from({ length: 5 }, () => drain()));
    for (const u of users) {
      expect((await mailbox.list(u.phone)).length).toBe(1);
      expect((await mailbox.list(u.email)).length).toBe(1);
    }
  });

  it('I-36 Unit 1\'s codes go through this unit: in both languages, in the mailbox, and only an HMAC of the number in the database', async () => {
    const phone = `+8801${randomInt(3, 10)}${String(randomInt(0, 1e8)).padStart(8, '0')}`;
    const port = t.app.get<NotificationPort>(NOTIFICATION_PORT);
    await port.sendSms(phone, 'otp_register', { code: '482913', minutes: '5' });
    const [m] = await mailbox.list(phone);
    expect(m.text).toBe('TrustBazaar: আপনার নিবন্ধনের কোড 482913। 5 মিনিট বৈধ। কাউকে জানাবেন না।\n\nTrustBazaar: your registration code is 482913. Valid for 5 minutes. Never share it.');
    const rows = await fx.query(`SELECT purpose, status FROM notify.sms_log WHERE phone_hmac = $1`, [(port as unknown as { phoneHmac(p: string): Buffer }).phoneHmac(phone)]);
    expect(rows).toEqual([{ purpose: 'otp', status: 'sent' }]);
    const leaked = await fx.query(`SELECT count(*)::int AS n FROM notify.sms_log WHERE provider_ref LIKE '%482913%'`);
    expect(leaked).toEqual([{ n: 0 }]);
    await expect(port.sendEmail('a@tb.test', 'no_such_template', {})).rejects.toThrow(/no message text/);
  });

  it('AS-4 staff read the development mailbox; users and guests cannot', async () => {
    const phone = `+8801${randomInt(3, 10)}${String(randomInt(0, 1e8)).padStart(8, '0')}`;
    await t.app.get<NotificationPort>(NOTIFICATION_PORT).sendSms(phone, 'otp_step_up', { code: '111222', minutes: '5' });
    const staffId = await fx.staff('operator');
    const sid = await fx.session({ staffId });
    const r = await fetch(t.url(`/staff/dev-mailbox?to=${encodeURIComponent(phone)}`), { headers: fx.headers(sid, staffId, 'staff') });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ simulated: true, items: [expect.objectContaining({ channel: 'sms', to: phone, simulated: true })] });
    const u = await user();
    const usid = await fx.session({ userId: u.userId });
    expect((await fetch(t.url('/staff/dev-mailbox'), { headers: fx.headers(usid, u.userId, 'user') })).status).toBe(401);
    expect((await fetch(t.url('/staff/dev-mailbox'))).status).toBe(401);
    expect(await t.app.get<Redis>(REDIS).ttl(DEV_MAILBOX_KEY)).toBeGreaterThan(6 * 24 * 3600);
  });

  it('DV-42 retention removes year-old history and 90-day-old delivery and SMS records', async () => {
    const u = await user();
    await t.app.get(NotificationConsumers).handle(event('identity.kyc.verified', { userId: u.userId }));
    await drain();
    await fx.query(`UPDATE notify.notifications SET created_at = now() - interval '366 days' WHERE user_id = $1`, [u.userId]);
    const fresh = await user();
    await t.app.get(NotificationConsumers).handle(event('identity.kyc.verified', { userId: fresh.userId }));
    await drain();
    await fx.query(`INSERT INTO notify.sms_log (phone_hmac, purpose, status, simulated, at) VALUES (decode(repeat('ab', 32), 'hex'), 'otp', 'sent', true, now() - interval '91 days')`);
    expect(await worker.purgeExpired()).toBeGreaterThanOrEqual(3);
    expect(await fx.query(`SELECT count(*)::int AS n FROM notify.notifications WHERE user_id = $1`, [u.userId])).toEqual([{ n: 0 }]);
    expect(await fx.query(`SELECT count(*)::int AS n FROM notify.notifications WHERE user_id = $1`, [fresh.userId])).toEqual([{ n: 1 }]);
    expect(await fx.query(`SELECT count(*)::int AS n FROM notify.sms_log WHERE at < now() - interval '90 days'`)).toEqual([{ n: 0 }]);
  });
});
