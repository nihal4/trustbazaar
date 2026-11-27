import { Controller, Get, Inject, Query } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Staff } from '../../../kernel/http/policies';
import { Problem } from '../../../kernel/http/problems';
import { DevMailbox } from '../adapters/dev-mailbox';

export class MailboxQuery {
  @IsOptional()
  @IsString()
  @MaxLength(254)
  to?: string;
}

export const DEV_MAILBOX = Symbol('DEV_MAILBOX');

// The development mailbox for staff (section 7.2): the simulated e-mails and SMS of log mode, newest first. Not
// found unless both channels are in log mode, so it never exists where messages are really sent.
@Controller('staff')
export class DevMailboxController {
  constructor(@Inject(DEV_MAILBOX) private readonly mailbox: DevMailbox | null) {}

  /** Development only: the messages the backend would have sent by e-mail or SMS, optionally for one recipient (404 when the mailbox is off). */
  @Staff()
  @Get('dev-mailbox')
  async list(@Query() q: MailboxQuery) {
    if (!this.mailbox) throw new Problem('not-found');
    return { simulated: true, items: await this.mailbox.list(q.to?.trim()) };
  }
}
