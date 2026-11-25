import { normaliseTo } from '../../../dev-mailbox';
import { compose, MESSAGES } from '../services/direct-messages';
import { channelsFor, maskAddress, SmtpEmailAdapter, TwilioSmsAdapter } from './channels';
import type { DevMailbox } from './dev-mailbox';

const clock = { now: () => new Date('2026-11-01T12:00:00Z') };

describe('e-mail and SMS channels', () => {
  it('IF-SW-05 log mode is simulated; an unknown mode is refused at start, not silently dropped', () => {
    const mailbox = {} as DevMailbox;
    expect(channelsFor({ emailMode: 'log', smsMode: 'log' }, mailbox, clock).email.simulated).toBe(true);
    expect(() => channelsFor({ emailMode: 'smtp', smsMode: 'log' }, mailbox, clock)).toThrow(/needs SMTP_URL/);
    expect(() => channelsFor({ emailMode: 'log', smsMode: 'twilio' }, mailbox, clock)).toThrow(/needs TWILIO_/);
    expect(() => channelsFor({ emailMode: 'log', smsMode: 'gateway' }, mailbox, clock)).toThrow(/SMS_MODE=gateway/);
  });

  it('IF-SW-05 the SMTP adapter sends the message from the configured address and is not simulated', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<m1@x>' });
    const email = new SmtpEmailAdapter({ sendMail }, 'TrustBazaar <no-reply@example.com>');
    await expect(email.send('a@b.com', 'Hi', 'Body')).resolves.toEqual({ ref: '<m1@x>' });
    expect(sendMail).toHaveBeenCalledWith({ from: 'TrustBazaar <no-reply@example.com>', to: 'a@b.com', subject: 'Hi', text: 'Body' });
    expect(email.simulated).toBe(false);
  });

  it('IF-SW-06 the Twilio adapter posts To, From and Body with basic auth; a refusal does not echo the response', async () => {
    const http = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM123' }) });
    const sms = new TwilioSmsAdapter({ accountSid: 'AC1', authToken: 'tok', from: '+15005550006' }, http as unknown as typeof fetch);
    await expect(sms.send('+8801712345678', 'code 123456')).resolves.toEqual({ ref: 'SM123' });
    const [url, init] = http.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from('AC1:tok').toString('base64')}`);
    expect(new URLSearchParams(init.body).get('To')).toBe('+8801712345678');
    http.mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: '+8801712345678 invalid' }) });
    await expect(sms.send('+8801712345678', 'x')).rejects.toThrow('Twilio refused the message (HTTP 400)');
  });

  it('SEC-DAT-07 the log line masks the address', () => {
    expect([maskAddress('+8801712345678'), maskAddress('rahim@example.com')]).toEqual(['***678', 'r***@example.com']);
  });

  it('I-3 every message Unit 1 sends has its text, in Bangla then English, with its values filled in', () => {
    for (const template of Object.keys(MESSAGES)) {
      const { text } = compose(template, { code: '123456', minutes: '5', hours: '24', link: 'https://x/y', kind: 'phone' });
      expect([template, text.includes('{')]).toEqual([template, false]);
      expect(text.split('\n\n')).toHaveLength(2);
    }
    expect(compose('password_reset', { link: 'L', minutes: '30' }).subject).toBe('পাসওয়ার্ড রিসেট / Reset your password');
    expect(() => compose('unknown', {})).toThrow(/no message text/);
  });

  it('IF-SW-05 the mailbox command accepts a local number as the stored international one (AS-4)', () => {
    expect([normaliseTo('01712345678'), normaliseTo('017 1234-5678'), normaliseTo('a@b.c'), normaliseTo(undefined)]).toEqual(['+8801712345678', '+8801712345678', 'a@b.c', undefined]);
  });
});
