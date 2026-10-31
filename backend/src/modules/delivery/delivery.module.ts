import { Module } from '@nestjs/common';

// Unit 4 (docs/design/04_delivery.pdf). Schemas: delivery.
// The courier adapter lives in adapters/.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class DeliveryModule {}
