import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from './db/entities';

// Unit 1 (docs/design/01_identity_access.pdf). Schemas: identity, audit.
// Also the security pipeline (guards: rate limit, auth, CSRF, policy, step-up).
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  providers: [],
  exports: [],
})
export class IdentityModule {}
