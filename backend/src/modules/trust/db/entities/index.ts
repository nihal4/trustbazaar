import { Dispute } from './dispute.entity';
import { DisputeEvidence } from './dispute-evidence.entity';
import { DisputeMessage } from './dispute-message.entity';
import { DisputeChatRead } from './dispute-chat-read.entity';
import { DisputeReturnCheck } from './dispute-return-check.entity';
import { DisputeBuyerFinding } from './dispute-buyer-finding.entity';
import { DisputeStatusChange } from './dispute-status-change.entity';
import { DisputesOutboxEvent } from './disputes-outbox-event.entity';
import { DisputeStatement } from './dispute-statement.entity';
import { ConfigValue } from './config-value.entity';
import { ConfigVersion } from './config-version.entity';
import { LawfulDisclosure } from './lawful-disclosure.entity';
import { DataExportRequest } from './data-export-request.entity';
import { RatingEligibility } from './rating-eligibility.entity';
import { Rating } from './rating.entity';
import { UserReport } from './user-report.entity';
import { Sanction } from './sanction.entity';
import { TrustSignal } from './trust-signal.entity';
import { TrustStrike } from './trust-strike.entity';

export { Dispute } from './dispute.entity';
export { DisputeEvidence } from './dispute-evidence.entity';
export { DisputeMessage } from './dispute-message.entity';
export { DisputeChatRead } from './dispute-chat-read.entity';
export { DisputeReturnCheck } from './dispute-return-check.entity';
export { DisputeBuyerFinding } from './dispute-buyer-finding.entity';
export { DisputeStatusChange } from './dispute-status-change.entity';
export { DisputesOutboxEvent } from './disputes-outbox-event.entity';
export { DisputeStatement } from './dispute-statement.entity';
export { ConfigValue } from './config-value.entity';
export { ConfigVersion } from './config-version.entity';
export { LawfulDisclosure } from './lawful-disclosure.entity';
export { DataExportRequest } from './data-export-request.entity';
export { RatingEligibility } from './rating-eligibility.entity';
export { Rating } from './rating.entity';
export { UserReport } from './user-report.entity';
export { Sanction } from './sanction.entity';
export { TrustSignal } from './trust-signal.entity';
export { TrustStrike } from './trust-strike.entity';

// Every table of the schemas disputes, trust, staff, for TypeOrmModule.forFeature.
export const ENTITIES = [
  Dispute,
  DisputeEvidence,
  DisputeMessage,
  DisputeChatRead,
  DisputeReturnCheck,
  DisputeBuyerFinding,
  DisputeStatusChange,
  DisputesOutboxEvent,
  DisputeStatement,
  ConfigValue,
  ConfigVersion,
  LawfulDisclosure,
  DataExportRequest,
  RatingEligibility,
  Rating,
  UserReport,
  Sanction,
  TrustSignal,
  TrustStrike,
];
