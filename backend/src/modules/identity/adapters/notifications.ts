import { Injectable, Logger } from '@nestjs/common';

// NotificationPort (Unit 1 section 4.5), implemented by the Notifications unit (Unit 6). Until it exists,
// this test adapter writes each message to the log, labelled as simulated (AS-4), with the number or
// address masked. It keeps the last messages in memory so the tests can see what would have been sent.
export interface NotificationPort {
  sendSms(phone: string, template: string, vars: Record<string, string>): Promise<void>;
  sendEmail(address: string, template: string, vars: Record<string, string>): Promise<void>;
}

export const NOTIFICATIONS = Symbol('NOTIFICATIONS');

export interface SentMessage {
  channel: 'sms' | 'email';
  to: string;
  template: string;
  vars: Record<string, string>;
}

const mask = (s: string) => (s.includes('@') ? s.replace(/^(.).*(@.*)$/, '$1***$2') : `***${s.slice(-3)}`);

@Injectable()
export class SimulatedNotifications implements NotificationPort {
  private readonly log = new Logger('Notifications');
  readonly sent: SentMessage[] = [];

  async sendSms(phone: string, template: string, vars: Record<string, string>): Promise<void> {
    this.keep({ channel: 'sms', to: phone, template, vars });
  }

  async sendEmail(address: string, template: string, vars: Record<string, string>): Promise<void> {
    this.keep({ channel: 'email', to: address, template, vars });
  }

  private keep(m: SentMessage): void {
    this.sent.push(m);
    if (this.sent.length > 100) this.sent.shift();
    this.log.log(`[simulated ${m.channel}] ${m.template} to ${mask(m.to)}`);
  }
}
