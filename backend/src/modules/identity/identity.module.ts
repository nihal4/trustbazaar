import { Module } from '@nestjs/common';

// Unit 1 (docs/design/01_identity_access.pdf). Schemas: identity, audit.
// Also the security pipeline (guards: rate limit, auth, CSRF, policy, step-up).
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class IdentityModule {}
