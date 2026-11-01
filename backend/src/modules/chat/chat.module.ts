import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ListingsModule } from '../listings/listings.module';
import { NotificationConsumers } from './consumers/notification.consumers';
import { ENTITIES } from './db/entities';
import { NotificationsController } from './http/notifications.controller';
import { NOTIFIER, Notifier } from './ports';
import { NotificationService } from './services/notification.service';

// Unit 6 (docs/design/06_chat_notifications.pdf). Schemas: chat, notify.
// E-mail and SMS adapters live in adapters/.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), ListingsModule],
  controllers: [NotificationsController],
  providers: [
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
