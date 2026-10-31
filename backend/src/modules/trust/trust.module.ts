import { Module } from '@nestjs/common';

// Unit 7 (docs/design/07_disputes_trust_staff.pdf). Schemas: disputes, trust, staff.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class TrustModule {}
