import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ENTITIES } from './db/entities';
import { IdentityModule } from '../identity/identity.module';
import { ConfigPortModule } from './config-port.module';
import { ConfigController } from './http/config.controller';
import { ConfigAdminService } from './services/config-admin.service';

// Unit 7 (docs/design/07_disputes_trust_staff.pdf). Schemas: disputes, trust, staff.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
// ConfigPort (U7-01) is provided globally by ConfigPortModule, for every unit.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), ConfigPortModule, IdentityModule],
  controllers: [ConfigController],
  providers: [ConfigAdminService],
  exports: [],
})
export class TrustModule {}
