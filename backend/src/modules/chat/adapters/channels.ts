import { Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Clock } from '../../../kernel/clock';
import { DevMailbox } from './dev-mailbox';

// The e-mail and SMS adapters (section 7.2; IF-SW-05, IF-SW-06): the only code that sends a message out of the
// system. Log mode, the only one built so far ("log mode first"), puts each message in the development mailbox and
// writes a log line with the address masked and no content. SMTP (U6-07) and Twilio (U6-07) replace it behind the
// same interfaces; an unknown mode is refused at start.
export interface EmailAdapter {
  readonly simulated: boolean;
  /** `html` is the same message in the one HTML layout; the text part always goes with it */
  send(to: string, subject: string, text: string, html?: string): Promise<{ ref: string }>;
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
  constructor(
    private readonly mailbox: DevMailbox,
    private readonly clock: Clock,
  ) {}

  async send(to: string, subject: string, text: string, html?: string): Promise<{ ref: string }> {
    await this.mailbox.put({ channel: 'email', to, subject, text, html }, this.clock.now());
    this.log.log(`[simulated email] to ${maskAddress(to)}`);
    return { ref: ref('email') };
  }
}

export class LogSmsAdapter implements SmsAdapter {
  readonly simulated = true;
  private readonly log = new Logger('SmsAdapter');
  constructor(
    private readonly mailbox: DevMailbox,
    private readonly clock: Clock,
  ) {}

  async send(to: string, text: string): Promise<{ ref: string }> {
    await this.mailbox.put({ channel: 'sms', to, subject: null, text }, this.clock.now());
    this.log.log(`[simulated sms] to ${maskAddress(to)}`);
    return { ref: ref('sms') };
  }
}

/** E-mail over SMTP (U6-07): SMTP_URL such as smtps://resend:KEY@smtp.resend.com:465, sent from EMAIL_FROM. */
export class SmtpEmailAdapter implements EmailAdapter {
  readonly simulated = false;
  private readonly log = new Logger('EmailAdapter');
  constructor(
    private readonly transport: Pick<Transporter, 'sendMail'>,
    private readonly from: string,
  ) {}

  async send(to: string, subject: string, text: string, html?: string): Promise<{ ref: string }> {
    const info = await this.transport.sendMail({ from: this.from, to, subject, text, ...(html ? { html } : {}) });
    this.log.log(`[email] to ${maskAddress(to)}`);
    return { ref: String(info.messageId ?? 'smtp') };
  }
}

export interface TwilioSettings {
  accountSid: string;
  authToken: string;
  from: string;
}

/** SMS through Twilio's REST API (U6-07). Test credentials or a trial account only reach verified numbers. */
export class TwilioSmsAdapter implements SmsAdapter {
  readonly simulated = false;
  private readonly log = new Logger('SmsAdapter');
  constructor(
    private readonly s: TwilioSettings,
    private readonly http: typeof fetch = fetch,
  ) {}

  async send(to: string, text: string): Promise<{ ref: string }> {
    const res = await this.http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.s.accountSid)}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.s.accountSid}:${this.s.authToken}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: this.s.from, Body: text }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Twilio refused the message (HTTP ${res.status})`); // never the body: it can echo the number
    const body = (await res.json()) as { sid?: string };
    this.log.log(`[sms] to ${maskAddress(to)}`);
    return { ref: body.sid ?? 'twilio' };
  }
}

export interface ChannelModes {
  emailMode: string;
  smsMode: string;
  providers?: Partial<Record<'smtpUrl' | 'twilioAccountSid' | 'twilioAuthToken' | 'twilioFrom', { reveal(): string }>>;
  emailFrom?: string;
}

/** The adapters for the configured modes; an unknown mode is refused at start, never silently dropped. */
export function channelsFor(modes: ChannelModes, mailbox: DevMailbox, clock: Clock): { email: EmailAdapter; sms: SmsAdapter } {
  let email: EmailAdapter;
  if (modes.emailMode === 'log') email = new LogEmailAdapter(mailbox, clock);
  else if (modes.emailMode === 'smtp') {
    const url = modes.providers?.smtpUrl?.reveal();
    if (!url) throw new Error('EMAIL_MODE=smtp needs SMTP_URL');
    email = new SmtpEmailAdapter(createTransport(url), modes.emailFrom ?? 'TrustBazaar <no-reply@localhost>');
  } else throw new Error(`EMAIL_MODE=${modes.emailMode} has no adapter; use log or smtp`);

  let sms: SmsAdapter;
  if (modes.smsMode === 'log') sms = new LogSmsAdapter(mailbox, clock);
  else if (modes.smsMode === 'twilio') {
    const p = modes.providers ?? {};
    if (!p.twilioAccountSid || !p.twilioAuthToken || !p.twilioFrom)
      throw new Error('SMS_MODE=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM');
    sms = new TwilioSmsAdapter({ accountSid: p.twilioAccountSid.reveal(), authToken: p.twilioAuthToken.reveal(), from: p.twilioFrom.reveal() });
  } else throw new Error(`SMS_MODE=${modes.smsMode} has no adapter; use log or twilio`);
  return { email, sms };
}
