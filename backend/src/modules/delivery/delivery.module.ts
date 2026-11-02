import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { CLOCK, Clock } from '../../kernel/clock';
import type { TbConfig } from '../../kernel/config/config';
import { TB_CONFIG } from '../../kernel/config/config.provider';
import { REDIS } from '../../kernel/redis.provider';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { COURIER } from './adapters/courier-port';
import { MockCourier } from './adapters/mock-courier';
import { ForwardedFulfilmentOrders, FULFILMENT_ORDERS } from './adapters/orders';
import { HandoverConsumers } from './consumers/handover.consumers';
import { ShipmentConsumers } from './consumers/shipment.consumers';
import { ENTITIES } from './db/entities';
import { DeliveryAdminController } from './http/delivery-admin.controller';
import { DeliveryStaffController } from './http/delivery-staff.controller';
import { DeliveryController } from './http/delivery.controller';
import { HandoverController } from './http/handover.controller';
import { MockCourierController } from './http/mock-courier.controller';
import { CourierWebhookController, ShipmentController } from './http/shipment.controller';
import { DeliveryJobs } from './jobs/delivery.jobs';
import { DELIVERY_COMMANDS, DELIVERY_PORT, DELIVERY_QUERIES } from './ports';
import { AddressService } from './services/address.service';
import { AreasService } from './services/areas.service';
import { BookingService } from './services/booking.service';
import { CourierBreaker } from './services/courier-breaker';
import { DeliveryPorts } from './services/delivery-ports.service';
import { FareTableService } from './services/fare-table.service';
import { HandoverService } from './services/handover.service';
import { MeetupPointsService } from './services/meetup-points.service';
import { QuoteService } from './services/quote.service';
import { RecordsService } from './services/records.service';
import { ShipmentService } from './services/shipment.service';
import { StatusService } from './services/status.service';

/**
 * The courier adapter chosen by COURIER_MODE (section 3.3). Only the mock exists until Pathao or Steadfast sandbox
 * access is granted; the configuration refuses COURIER_MODE=sandbox until then (Decisions log, U4-04).
 */
export function buildCourier(config: TbConfig, redis: Redis, clock: Clock): MockCourier {
  const secret = config.providers.courierWebhookSecret?.reveal();
  return new MockCourier(redis, secret, () => clock.now(), config.mockCourierAutoAdvanceSeconds);
}

// Unit 4 (docs/design/04_delivery.pdf). Schemas: delivery.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
// Unit 2 imports this module (DeliveryPort, I-21, I-22); this unit reaches Unit 2's ports on first use (adapters/orders.ts, U4-03).
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule],
  controllers: [
    DeliveryController, DeliveryAdminController, HandoverController, ShipmentController, CourierWebhookController, DeliveryStaffController, MockCourierController,
  ],
  providers: [
    AreasService, FareTableService, AddressService, QuoteService, MeetupPointsService, HandoverService, HandoverConsumers,
    CourierBreaker, StatusService, BookingService, ShipmentService, RecordsService, ShipmentConsumers, DeliveryJobs, DeliveryPorts,
    { provide: COURIER, inject: [TB_CONFIG, REDIS, CLOCK], useFactory: buildCourier },
    { provide: FULFILMENT_ORDERS, useClass: ForwardedFulfilmentOrders },
    { provide: DELIVERY_PORT, useExisting: DeliveryPorts },
    { provide: DELIVERY_COMMANDS, useExisting: DeliveryPorts },
    { provide: DELIVERY_QUERIES, useExisting: DeliveryPorts },
  ],
  exports: [DELIVERY_PORT, DELIVERY_COMMANDS, DELIVERY_QUERIES],
})
export class DeliveryModule {}
