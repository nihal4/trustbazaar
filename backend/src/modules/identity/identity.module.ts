import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NOTIFICATIONS, SimulatedNotifications } from './adapters/notifications';
import { PasswordHasher } from './crypto/password';
import { ENTITIES } from './db/entities';
import { AuthController } from './http/auth.controller';
import { pipelineGuards } from './security/guards';
import { RateLimiter } from './security/rate-limiter.service';
import { noRestrictionsYet, RESTRICTIONS } from './security/restrictions';
import { AuditService } from './services/audit.service';
import { SessionService } from './services/session.service';
import { SignInService } from './services/signin.service';

// Unit 1 (docs/design/01_identity_access.pdf). Schemas: identity, audit.
// Also the security pipeline that every request passes (section 4.1): RateLimitGuard, AuthGuard, CsrfGuard,
// PolicyGuard, StepUpGuard, registered globally here. Routes declare their policy with the kernel's
// decorators (kernel/http/policies.ts).
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  controllers: [AuthController],
  providers: [
    RateLimiter,
    PasswordHasher,
    AuditService,
    SessionService,
    SignInService,
    // Until the Notifications unit (Unit 6) provides NotificationPort: logged, labelled simulated (AS-4).
    SimulatedNotifications,
    { provide: NOTIFICATIONS, useExisting: SimulatedNotifications },
    { provide: RESTRICTIONS, useValue: noRestrictionsYet },
    ...pipelineGuards,
  ],
  exports: [],
})
export class IdentityModule {}
