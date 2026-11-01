import { normaliseTo } from '../../../dev-mailbox';
import { compose, MESSAGES } from '../services/direct-messages';
import { channelsFor, maskAddress } from './channels';
import type { DevMailbox } from './dev-mailbox';

const clock = { now: () => new Date('2026-11-01T12:00:00Z') };

describe('e-mail and SMS channels', () => {
  it('IF-SW-05 only log mode is built; another mode is refused at start, not silently dropped', () => {
    const mailbox = {} as DevMailbox;
    expect(channelsFor({ emailMode: 'log', smsMode: 'log' }, mailbox, clock).email.simulated).toBe(true);
    expect(() => channelsFor({ emailMode: 'smtp', smsMode: 'log' }, mailbox, clock)).toThrow(/EMAIL_MODE=smtp has no adapter yet/);
    expect(() => channelsFor({ emailMode: 'log', smsMode: 'gateway' }, mailbox, clock)).toThrow(/SMS_MODE=gateway/);
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

  it('AS-4 the mailbox command accepts a local number as the stored international one', () => {
    expect([normaliseTo('01712345678'), normaliseTo('017 1234-5678'), normaliseTo('a@b.c'), normaliseTo(undefined)]).toEqual(['+8801712345678', '+8801712345678', 'a@b.c', undefined]);
  });
});
