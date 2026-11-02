import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { ENTITIES } from './db/entities';
import { DeliveryAdminController } from './http/delivery-admin.controller';
import { DeliveryController } from './http/delivery.controller';
import { DELIVERY_PORT } from './ports';
import { AddressService } from './services/address.service';
import { AreasService } from './services/areas.service';
import { FareTableService } from './services/fare-table.service';
import { QuoteService } from './services/quote.service';

// Unit 4 (docs/design/04_delivery.pdf). Schemas: delivery.
// The courier adapter lives in adapters/ (U4-04).
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
// Unit 2 imports this module (DeliveryPort, I-21); this unit reaches Unit 2's ports on first use when it needs them (U4-03).
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule],
  controllers: [DeliveryController, DeliveryAdminController],
  providers: [AreasService, FareTableService, AddressService, QuoteService, { provide: DELIVERY_PORT, useExisting: QuoteService }],
  exports: [DELIVERY_PORT],
})
export class DeliveryModule {}
