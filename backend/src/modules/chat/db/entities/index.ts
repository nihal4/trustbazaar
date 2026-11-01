import { UserBlock } from './user-block.entity';
import { DetectionTerm } from './detection-term.entity';
import { ChatMessage } from './chat-message.entity';
import { ChatOutboxEvent } from './chat-outbox-event.entity';
import { ChatStaffAccess } from './chat-staff-access.entity';
import { ThreadHold } from './thread-hold.entity';
import { ChatThread } from './chat-thread.entity';
import { ChatEmailState } from './chat-email-state.entity';
import { NotificationDelivery } from './notification-delivery.entity';
import { Notification } from './notification.entity';
import { NotificationPreference } from './notification-preference.entity';
import { Reminder } from './reminder.entity';
import { SmsLogEntry } from './sms-log-entry.entity';
import { NotificationTemplate } from './notification-template.entity';
import { ListingWatch } from './listing-watch.entity';

export { UserBlock } from './user-block.entity';
export { DetectionTerm } from './detection-term.entity';
export { ChatMessage } from './chat-message.entity';
export { ChatOutboxEvent } from './chat-outbox-event.entity';
export { ChatStaffAccess } from './chat-staff-access.entity';
export { ThreadHold } from './thread-hold.entity';
export { ChatThread } from './chat-thread.entity';
export { ChatEmailState } from './chat-email-state.entity';
export { NotificationDelivery } from './notification-delivery.entity';
export { Notification } from './notification.entity';
export { NotificationPreference } from './notification-preference.entity';
export { Reminder } from './reminder.entity';
export { SmsLogEntry } from './sms-log-entry.entity';
export { NotificationTemplate } from './notification-template.entity';
export { ListingWatch } from './listing-watch.entity';

// Every table of the schemas chat, notify, for TypeOrmModule.forFeature.
export const ENTITIES = [
  UserBlock,
  DetectionTerm,
  ChatMessage,
  ChatOutboxEvent,
  ChatStaffAccess,
  ThreadHold,
  ChatThread,
  ChatEmailState,
  NotificationDelivery,
  Notification,
  NotificationPreference,
  Reminder,
  SmsLogEntry,
  NotificationTemplate,
  ListingWatch,
];
