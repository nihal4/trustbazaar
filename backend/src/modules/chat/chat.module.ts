import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { CLOCK, Clock } from '../../kernel/clock';
import { TbConfig } from '../../kernel/config/config';
import { TB_CONFIG } from '../../kernel/config/config.provider';
import { REDIS } from '../../kernel/redis.provider';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { channelsFor, EMAIL_ADAPTER, SMS_ADAPTER } from './adapters/channels';
import { DevMailbox } from './adapters/dev-mailbox';
import { DEV_MAILBOX, DevMailboxController } from './http/dev-mailbox.controller';
import { NotifyJobs } from './jobs/notify.jobs';
import { DeliveryService } from './services/delivery.service';
import { DirectMessages } from './services/direct-messages';
import { NotificationConsumers } from './consumers/notification.consumers';
import { ENTITIES } from './db/entities';
import { NotificationsController } from './http/notifications.controller';
import { NOTIFICATION_PORT, NOTIFIER, Notifier } from './ports';
import { NotificationService } from './services/notification.service';

// Unit 6 (docs/design/06_chat_notifications.pdf). Schemas: chat, notify.
// E-mail and SMS adapters live in adapters/.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule],
  controllers: [NotificationsController, DevMailboxController],
  providers: [
    // log mode only, so far (U6-05); another mode is refused at start until its adapter exists
    {
      provide: DEV_MAILBOX,
      inject: [TB_CONFIG, REDIS],
      useFactory: (c: TbConfig, r: Redis) => (c.emailMode === 'log' && c.smsMode === 'log' ? new DevMailbox(r) : null),
    },
    {
      provide: 'CHANNELS',
      inject: [TB_CONFIG, REDIS, CLOCK],
      useFactory: (c: TbConfig, r: Redis, clock: Clock) => channelsFor(c, new DevMailbox(r), clock),
    },
    { provide: EMAIL_ADAPTER, inject: ['CHANNELS'], useFactory: (ch: ReturnType<typeof channelsFor>) => ch.email },
    { provide: SMS_ADAPTER, inject: ['CHANNELS'], useFactory: (ch: ReturnType<typeof channelsFor>) => ch.sms },
    DirectMessages,
    { provide: NOTIFICATION_PORT, useExisting: DirectMessages },
    DeliveryService,
    NotifyJobs,
    NotificationService,
    NotificationConsumers,
    {
      provide: NOTIFIER,
      inject: [NotificationService],
      useFactory: (n: NotificationService): Notifier => ({
        notify: async (userId, template, params, key) => {
          const id = await n.create(userId, template, params, key);
          if (id) await n.push(userId, id);
        },
      }),
    },
  ],
  exports: [NOTIFIER],
})
export class ChatModule {}
