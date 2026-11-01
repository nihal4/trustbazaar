import { Logger } from '@nestjs/common';
import type { Clock } from '../../../kernel/clock';
import { DevMailbox } from './dev-mailbox';

// The e-mail and SMS adapters (section 7.2; IF-SW-05, IF-SW-06): the only code that sends a message out of the
// system. Log mode, the only one built so far ("log mode first"), puts each message in the development mailbox and
// writes a log line with the address masked and no content. A provider adapter (SMTP, an SMS gateway with a test
// mode) replaces it behind the same interfaces; until one exists, another mode is refused at start.
export interface EmailAdapter {
  readonly simulated: boolean;
  send(to: string, subject: string, text: string): Promise<{ ref: string }>;
}
export interface SmsAdapter {
  readonly simulated: boolean;
  send(to: string, text: string): Promise<{ ref: string }>;
}
export const EMAIL_ADAPTER = Symbol('EMAIL_ADAPTER');
export const SMS_ADAPTER = Symbol('SMS_ADAPTER');

export const maskAddress = (s: string) => (s.includes('@') ? s.replace(/^(.).*(@.*)$/, '$1***$2') : `***${s.slice(-3)}`);

let n = 0;
const ref = (channel: string) => `sim-${channel}-${Date.now().toString(36)}-${(n++).toString(36)}`;

export class LogEmailAdapter implements EmailAdapter {
  readonly simulated = true;
  private readonly log = new Logger('EmailAdapter');
  constructor(private readonly mailbox: DevMailbox, private readonly clock: Clock) {}

  async send(to: string, subject: string, text: string): Promise<{ ref: string }> {
    await this.mailbox.put({ channel: 'email', to, subject, text }, this.clock.now());
    this.log.log(`[simulated email] to ${maskAddress(to)}`);
    return { ref: ref('email') };
  }
}

export class LogSmsAdapter implements SmsAdapter {
  readonly simulated = true;
  private readonly log = new Logger('SmsAdapter');
  constructor(private readonly mailbox: DevMailbox, private readonly clock: Clock) {}

  async send(to: string, text: string): Promise<{ ref: string }> {
    await this.mailbox.put({ channel: 'sms', to, subject: null, text }, this.clock.now());
    this.log.log(`[simulated sms] to ${maskAddress(to)}`);
    return { ref: ref('sms') };
  }
}

/** The adapters for the configured modes; anything but log mode is refused at start until its adapter exists. */
export function channelsFor(modes: { emailMode: string; smsMode: string }, mailbox: DevMailbox, clock: Clock): { email: EmailAdapter; sms: SmsAdapter } {
  if (modes.emailMode !== 'log') throw new Error(`EMAIL_MODE=${modes.emailMode} has no adapter yet; use log (U6-05 builds log mode first)`);
  if (modes.smsMode !== 'log') throw new Error(`SMS_MODE=${modes.smsMode} has no adapter yet; use log (U6-05 builds log mode first)`);
  return { email: new LogEmailAdapter(mailbox, clock), sms: new LogSmsAdapter(mailbox, clock) };
}
