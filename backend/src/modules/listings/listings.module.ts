import { Module } from '@nestjs/common';

// Unit 3 (docs/design/03_listings_auctions.pdf). Schemas: listings, auctions.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
@Module({
  imports: [],
  providers: [],
  exports: [],
})
export class ListingsModule {}
