import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from './db/entities';

// Unit 2 (docs/design/02_orders_payments.pdf). Schemas: orders, payments.
// Payment provider adapters live in adapters/.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  providers: [],
  exports: [],
})
export class OrdersModule {}
