import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NOTIFICATION_PORT, NotificationPort, SentMessage } from '../../chat/ports';

// NotificationPort (Unit 1 section 4.5) is implemented by the Notifications unit (Unit 6; I-36, U6-05). This unit
// injects NOTIFICATIONS; the provider below forwards to Unit 6's port, found on first use, since Unit 6 is built on
// top of this unit and cannot be imported by it. `sent` exposes Unit 6's record of recent messages to the tests.
export type { NotificationPort, SentMessage } from '../../chat/ports';

export const NOTIFICATIONS = Symbol('NOTIFICATIONS');

@Injectable()
export class ForwardedNotifications implements NotificationPort {
  constructor(private readonly modules: ModuleRef) {}

  private get port(): NotificationPort & { sent?: SentMessage[] } {
    return this.modules.get(NOTIFICATION_PORT, { strict: false });
  }

  sendSms(phone: string, template: string, vars: Record<string, string>): Promise<void> {
    return this.port.sendSms(phone, template, vars);
  }

  sendEmail(address: string, template: string, vars: Record<string, string>): Promise<void> {
    return this.port.sendEmail(address, template, vars);
  }

  /** The tests read what would have been sent. */
  get sent(): SentMessage[] {
    return this.port.sent ?? [];
  }
}
