import { AuditEvent } from './audit-event.entity';
import { Approval } from './approval.entity';
import { Consent } from './consent.entity';
import { IdentityClaim } from './identity-claim.entity';
import { KnownDevice } from './known-device.entity';
import { KycFile } from './kyc-file.entity';
import { KycStatusChange } from './kyc-status-change.entity';
import { KycSubmission } from './kyc-submission.entity';
import { NidBlacklistEntry } from './nid-blacklist-entry.entity';
import { OneTimeToken } from './one-time-token.entity';
import { OtpChallenge } from './otp-challenge.entity';
import { IdentityOutboxEvent } from './identity-outbox-event.entity';
import { PendingRegistration } from './pending-registration.entity';
import { RecoveryCode } from './recovery-code.entity';
import { RefreshToken } from './refresh-token.entity';
import { Session } from './session.entity';
import { StaffAccount } from './staff-account.entity';
import { StaffConflict } from './staff-conflict.entity';
import { TotpFactor } from './totp-factor.entity';
import { User } from './user.entity';
import { WebauthnCredential } from './webauthn-credential.entity';

export { AuditEvent } from './audit-event.entity';
export { Approval } from './approval.entity';
export { Consent } from './consent.entity';
export { IdentityClaim } from './identity-claim.entity';
export { KnownDevice } from './known-device.entity';
export { KycFile } from './kyc-file.entity';
export { KycStatusChange } from './kyc-status-change.entity';
export { KycSubmission } from './kyc-submission.entity';
export { NidBlacklistEntry } from './nid-blacklist-entry.entity';
export { OneTimeToken } from './one-time-token.entity';
export { OtpChallenge } from './otp-challenge.entity';
export { IdentityOutboxEvent } from './identity-outbox-event.entity';
export { PendingRegistration } from './pending-registration.entity';
export { RecoveryCode } from './recovery-code.entity';
export { RefreshToken } from './refresh-token.entity';
export { Session } from './session.entity';
export { StaffAccount } from './staff-account.entity';
export { StaffConflict } from './staff-conflict.entity';
export { TotpFactor } from './totp-factor.entity';
export { User } from './user.entity';
export { WebauthnCredential } from './webauthn-credential.entity';

// Every table of the schemas identity, audit, for TypeOrmModule.forFeature.
export const ENTITIES = [
  AuditEvent,
  Approval,
  Consent,
  IdentityClaim,
  KnownDevice,
  KycFile,
  KycStatusChange,
  KycSubmission,
  NidBlacklistEntry,
  OneTimeToken,
  OtpChallenge,
  IdentityOutboxEvent,
  PendingRegistration,
  RecoveryCode,
  RefreshToken,
  Session,
  StaffAccount,
  StaffConflict,
  TotpFactor,
  User,
  WebauthnCredential,
];
