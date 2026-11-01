import { IdentityAccess1793491200001 } from './1793491200001-identity-access';
import { OrdersPayments1793491200002 } from './1793491200002-orders-payments';
import { ListingsAuctions1793491200003 } from './1793491200003-listings-auctions';
import { Delivery1793491200004 } from './1793491200004-delivery';
import { GameAccounts1793491200005 } from './1793491200005-game-accounts';
import { ChatNotifications1793491200006 } from './1793491200006-chat-notifications';
import { DisputesTrustStaff1793491200007 } from './1793491200007-disputes-trust-staff';
import { Integration1793491200008 } from './1793491200008-integration';
import { ListingsCourierPhotosStock1793491200009 } from './1793491200009-listings-courier-photos-stock';
import { NotificationTemplates1793491200010 } from './1793491200010-notification-templates';

// The migrations in the order they run: the seven units in unit order, then 09_integration (I-60).
// Add a new migration at the end; never reorder or edit an applied one.
export const MIGRATIONS = [
  IdentityAccess1793491200001, // docs/design/sql/01_identity_access.sql
  OrdersPayments1793491200002, // docs/design/sql/02_orders_payments.sql
  ListingsAuctions1793491200003, // docs/design/sql/03_listings_auctions.sql
  Delivery1793491200004, // docs/design/sql/04_delivery.sql
  GameAccounts1793491200005, // docs/design/sql/05_game_accounts.sql
  ChatNotifications1793491200006, // docs/design/sql/06_chat_notifications.sql
  DisputesTrustStaff1793491200007, // docs/design/sql/07_disputes_trust_staff.sql
  Integration1793491200008, // docs/design/sql/09_integration.sql
  ListingsCourierPhotosStock1793491200009, // U3-02 changes to 03_listings_auctions.sql (Decisions log)
  NotificationTemplates1793491200010, // U6-04: notification subject (I-55) and the first templates (Decisions log)
];
