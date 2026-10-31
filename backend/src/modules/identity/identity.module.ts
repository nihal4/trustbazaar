import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from './db/entities';
import { pipelineGuards } from './security/guards';
import { RateLimiter } from './security/rate-limiter.service';
import { noRestrictionsYet, RESTRICTIONS } from './security/restrictions';

// Unit 1 (docs/design/01_identity_access.pdf). Schemas: identity, audit.
// Also the security pipeline that every request passes (section 4.1): RateLimitGuard, AuthGuard, CsrfGuard,
// PolicyGuard, StepUpGuard, registered globally here. Routes declare their policy with the kernel's
// decorators (kernel/http/policies.ts).
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  providers: [RateLimiter, { provide: RESTRICTIONS, useValue: noRestrictionsYet }, ...pipelineGuards],
  exports: [],
})
export class IdentityModule {}
