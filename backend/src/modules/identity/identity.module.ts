import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NOTIFICATIONS, SimulatedNotifications } from './adapters/notifications';
import { FileVault } from './crypto/file-vault';
import { IdentityCrypto } from './crypto/identity-crypto';
import { PasswordHasher } from './crypto/password';
import { ENTITIES } from './db/entities';
import { IdentityJobs } from './jobs/identity.jobs';
import {
  APPROVAL_SERVICE, AUDIT_SERVICE, FILE_VAULT, IDENTITY_COMMANDS, IDENTITY_CRYPTO, IDENTITY_QUERY, RATE_LIMITER, STAFF_QUERY,
} from './ports';
import { AccountController } from './http/account.controller';
import { AuthController } from './http/auth.controller';
import { FilesController, KycController, StaffKycController } from './http/kyc.controller';
import { RegistrationController } from './http/registration.controller';
import { AdminController, StaffAuthController, StaffController } from './http/staff.controller';
import { pipelineGuards } from './security/guards';
import { RateLimiter } from './security/rate-limiter.service';
import { noRestrictionsYet, RESTRICTIONS } from './security/restrictions';
import { ApprovalService } from './services/approval.service';
import { AuditService } from './services/audit.service';
import { StaffAuthService } from './services/staff-auth.service';
import { StaffService } from './services/staff.service';
import { ContactService } from './services/contact.service';
import {
  ApprovalPortAdapter, AuditPortAdapter, FileVaultPortAdapter, IdentityCommandsService, IdentityQueryService, RateLimiterPortAdapter,
  StaffQueryService,
} from './services/identity-ports';
import { KycReviewService } from './services/kyc-review.service';
import { KycService } from './services/kyc.service';
import { OtpService } from './services/otp.service';
import { PasswordService } from './services/password.service';
import { RegistrationService } from './services/registration.service';
import { SecondFactorService } from './services/second-factor.service';
import { SessionService } from './services/session.service';
import { SignInService } from './services/signin.service';
import { SignInThrottle } from './services/signin-throttle.service';
import { StepUpService } from './services/step-up.service';

// Unit 1 (docs/design/01_identity_access.pdf). Schemas: identity, audit.
// Also the security pipeline that every request passes (section 4.1): RateLimitGuard, AuthGuard, CsrfGuard,
// PolicyGuard, StepUpGuard, registered globally here. Routes declare their policy with the kernel's
// decorators (kernel/http/policies.ts).
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  controllers: [AuthController, RegistrationController, AccountController, StaffAuthController, StaffController, AdminController, KycController, StaffKycController, FilesController],
  providers: [
    RateLimiter,
    PasswordHasher,
    AuditService,
    SessionService,
    SignInService,
    SignInThrottle,
    OtpService,
    SecondFactorService,
    StepUpService,
    PasswordService,
    ContactService,
    ApprovalService,
    StaffAuthService,
    StaffService,
    IdentityCrypto,
    FileVault,
    KycService,
    KycReviewService,
    IdentityJobs,
    // The ports (ports/index.ts): the only things other units may use (DC-1).
    { provide: IDENTITY_QUERY, useClass: IdentityQueryService },
    { provide: IDENTITY_COMMANDS, useClass: IdentityCommandsService },
    { provide: STAFF_QUERY, useClass: StaffQueryService },
    { provide: APPROVAL_SERVICE, useClass: ApprovalPortAdapter },
    { provide: AUDIT_SERVICE, useClass: AuditPortAdapter },
    { provide: RATE_LIMITER, useClass: RateLimiterPortAdapter },
    { provide: FILE_VAULT, useClass: FileVaultPortAdapter },
    { provide: IDENTITY_CRYPTO, useExisting: IdentityCrypto },
    RegistrationService,
    // Until the Notifications unit (Unit 6) provides NotificationPort: logged, labelled simulated (AS-4).
    SimulatedNotifications,
    { provide: NOTIFICATIONS, useExisting: SimulatedNotifications },
    { provide: RESTRICTIONS, useValue: noRestrictionsYet },
    ...pipelineGuards,
  ],
  exports: [IDENTITY_QUERY, IDENTITY_COMMANDS, STAFF_QUERY, APPROVAL_SERVICE, AUDIT_SERVICE, RATE_LIMITER, FILE_VAULT, IDENTITY_CRYPTO],
})
export class IdentityModule {}
