import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { ENTITIES } from './db/entities';
import { DeliveryAdminController } from './http/delivery-admin.controller';
import { DeliveryController } from './http/delivery.controller';
import { DELIVERY_COMMANDS, DELIVERY_PORT } from './ports';
import { ForwardedFulfilmentOrders, FULFILMENT_ORDERS } from './adapters/orders';
import { HandoverConsumers } from './consumers/handover.consumers';
import { HandoverController } from './http/handover.controller';
import { HandoverService } from './services/handover.service';
import { MeetupPointsService } from './services/meetup-points.service';
import { AddressService } from './services/address.service';
import { AreasService } from './services/areas.service';
import { FareTableService } from './services/fare-table.service';
import { QuoteService } from './services/quote.service';

// Unit 4 (docs/design/04_delivery.pdf). Schemas: delivery.
// The courier adapter lives in adapters/ (U4-04).
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
// Unit 2 imports this module (DeliveryPort, I-21); this unit reaches Unit 2's ports on first use (adapters/orders.ts, U4-03).
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule],
  controllers: [DeliveryController, DeliveryAdminController, HandoverController],
  providers: [
    AreasService, FareTableService, AddressService, QuoteService, MeetupPointsService, HandoverService, HandoverConsumers,
    { provide: FULFILMENT_ORDERS, useClass: ForwardedFulfilmentOrders },
    { provide: DELIVERY_PORT, useExisting: QuoteService },
    { provide: DELIVERY_COMMANDS, useExisting: HandoverService },
  ],
  exports: [DELIVERY_PORT, DELIVERY_COMMANDS],
})
export class DeliveryModule {}
