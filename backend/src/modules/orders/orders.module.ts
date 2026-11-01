import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { ENTITIES } from './db/entities';
import { OrdersController } from './http/orders.controller';
import { MockPayController, PaymentsController, StripeWebhookController } from './http/payments.controller';
import { ESCROW_COMMANDS, ESCROW_QUERY, ORDERS_PORT } from './ports';
import { EscrowService } from './services/escrow.service';
import { OrderService } from './services/order.service';
import { PAYMENT_PROVIDERS, PaymentService } from './services/payment.service';
import { buildProviders } from './adapters/providers';
import { TB_CONFIG } from '../../kernel/config/config.provider';
import { REDIS } from '../../kernel/redis.provider';
import type { TbConfig } from '../../kernel/config/config';
import type Redis from 'ioredis';

// Unit 2 (docs/design/02_orders_payments.pdf). Schemas: orders, payments.
// Payment provider adapters live in adapters/.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), IdentityModule, ListingsModule],
  controllers: [OrdersController, PaymentsController, StripeWebhookController, MockPayController],
  providers: [
    OrderService,
    PaymentService,
    { provide: PAYMENT_PROVIDERS, inject: [TB_CONFIG, REDIS], useFactory: (c: TbConfig, r: Redis) => buildProviders(c, r) },
    { provide: ORDERS_PORT, useExisting: OrderService },
    EscrowService,
    { provide: ESCROW_COMMANDS, useExisting: EscrowService },
    { provide: ESCROW_QUERY, useExisting: EscrowService },
  ],
  exports: [ORDERS_PORT, ESCROW_COMMANDS, ESCROW_QUERY],
})
export class OrdersModule {}
