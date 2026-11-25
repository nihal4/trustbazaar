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
import { OwnMeetupPlaces1793491200013 } from './1793491200013-own-meetup-places';
import { ChatDetectionTermDelete1793491200012 } from './1793491200012-chat-detection-term-delete';
import { ChatImageKeyTemplate1793491200011 } from './1793491200011-chat-image-key-template';
import { ReminderTemplates1793491200014 } from './1793491200014-reminder-templates';
import { TrustNoticeTemplates1793491200015 } from './1793491200015-trust-notice-templates';
import { DisputeEvidenceKey1793491200016 } from './1793491200016-dispute-evidence-key';
import { DisputeNoticeTemplates1793491200017 } from './1793491200017-dispute-notice-templates';
import { DisputeDecisionTemplates1793491200018 } from './1793491200018-dispute-decision-templates';
import { DisputePurge1793491200019 } from './1793491200019-dispute-purge';
import { DisclosureNoticeTemplate1793491200020 } from './1793491200020-disclosure-notice-template';
import { OwnershipScreenshotKey1793491200021 } from './1793491200021-ownership-screenshot-key';
import { OwnershipRejectedTemplate1793491200022 } from './1793491200022-ownership-rejected-template';
import { GameHandoverTemplates1793491200023 } from './1793491200023-game-handover-templates';
import { GameTakeoverTemplates1793491200024 } from './1793491200024-game-takeover-templates';
import { GameRetention1793491200025 } from './1793491200025-game-retention';
import { ListingReviewTemplates1793491200026 } from './1793491200026-listing-review-templates';
import { ScreeningTermDelete1793491200027 } from './1793491200027-screening-term-delete';
import { FeaturedEnded1793491200028 } from './1793491200028-featured-ended';
import { ProSellerPrice1793491200029 } from './1793491200029-pro-seller-price';
import { ProSellerTemplates1793491200030 } from './1793491200030-pro-seller-templates';
import { IdentityErasure1793491200031 } from './1793491200031-identity-erasure';
import { DataExport1793491200032 } from './1793491200032-data-export';
import { LinkedAccounts1793491200033 } from './1793491200033-linked-accounts';
import { SavedPaymentMethods1793491200034 } from './1793491200034-saved-payment-methods';

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
  ChatImageKeyTemplate1793491200011, // U6-02: chat image keys of Unit 1's FileVault, and the chat notice (Decisions log)
  ChatDetectionTermDelete1793491200012, // U6-03: operators remove detection terms (Decisions log)
  OwnMeetupPlaces1793491200013, // U4-03: a meetup at a place of the parties' own (Decisions log)
  ReminderTemplates1793491200014, // U6-06: the deadline reminders' templates (Decisions log)
  TrustNoticeTemplates1793491200015, // U7-04: the notices of sanctions and resolved reports (Decisions log)
  DisputeEvidenceKey1793491200016, // U7-03: dispute evidence keys of Unit 1's FileVault (Decisions log)
  DisputeNoticeTemplates1793491200017, // U7-03: the notices of a dispute's opening and withdrawal (Decisions log)
  DisputeDecisionTemplates1793491200018, // U7-03: the notices of a dispute's decision and of a request for information (Decisions log)
  DisputePurge1793491200019, // U7-07: dispute statements and evidence purged at the end of retention, I-63 (Decisions log)
  DisclosureNoticeTemplate1793491200020, // U7-07: the user's notice of a lawful disclosure (Decisions log)
  OwnershipScreenshotKey1793491200021, // U5-02: ownership screenshots' FileVault keys (Decisions log)
  OwnershipRejectedTemplate1793491200022, // U5-02: the seller's notice of a rejected ownership proof (Decisions log)
  GameHandoverTemplates1793491200023, // U5-03: the notices of credentials requested and delivered (I-32; Decisions log)
  GameTakeoverTemplates1793491200024, // U5-04: the notices of a re-key and of the completed takeover (I-32; Decisions log)
  GameRetention1793491200025, // U5-05: access-log and ownership-screenshot retention, I-63 and DV-39 (Decisions log)
  ListingReviewTemplates1793491200026, // U3-08: the notices of a returned and a removed listing (Decisions log)
  ScreeningTermDelete1793491200027, // U3-08: operators may delete screening terms (Decisions log)
  FeaturedEnded1793491200028, // U2-06: featured_purchases.ended_at, set with payments.featured.ended (Decisions log)
  ProSellerPrice1793491200029, // U2-06: CP-48, the Pro Seller monthly price (Decisions log)
  ProSellerTemplates1793491200030, // U2-06: the Pro Seller's renewal-due and lapse notices (Decisions log)
  IdentityErasure1793491200031, // U1-09: identity.erase_user and identity.erase_rejected_kyc (Decisions log)
  DataExport1793491200032, // U7-11: export_requests.file_key widened; the privacy.export_ready notice (Decisions log)
  LinkedAccounts1793491200033, // U7-09: the device-key and payout lookups of the linked-account check (Decisions log)
  SavedPaymentMethods1793491200034, // U10-23: the buyer's default payment method, masked (Decisions log)
];
