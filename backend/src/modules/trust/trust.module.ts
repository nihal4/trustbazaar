import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from '../chat/chat.module';
import { IdentityModule } from '../identity/identity.module';
import { ListingsModule } from '../listings/listings.module';
import { ConfigPortModule } from './config-port.module';
import { TrustConsumers } from './consumers/trust.consumers';
import { ENTITIES } from './db/entities';
import { ConfigController } from './http/config.controller';
import { TrustController } from './http/trust.controller';
import { CASE_QUERY, REPORT_COMMANDS, SANCTION_PORT, TRUST_QUERY } from './ports';
import { ConfigAdminService } from './services/config-admin.service';
import { TrustReportService } from './services/report.service';
import { RatingService } from './services/rating.service';
import { SanctionService } from './services/sanction.service';
import { SignalService } from './services/signal.service';

// Unit 7 (docs/design/07_disputes_trust_staff.pdf). Schemas: disputes, trust, staff.
// Folder layout and rules: BUILDING.md section 3. This module exports only its ports (ports/),
// and imports other units only through their ports (DC-1; enforced by .eslintrc.js).
// Repositories (DC-2) are TypeORM's, injected with @InjectRepository(Entity) inside this unit only.
// ConfigPort (U7-01) is provided globally by ConfigPortModule, for every unit.
// Unit 1 (restrictions, I-43) and Unit 6 (chat reports, the staff thread read) import neither this module nor its
// providers: they find REPORT_COMMANDS, SANCTION_PORT and CASE_QUERY on first use (ModuleRef), since this unit
// imports them.
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES), ConfigPortModule, IdentityModule, ChatModule, ListingsModule],
  controllers: [ConfigController, TrustController],
  providers: [
    ConfigAdminService,
    TrustReportService,
    SanctionService,
    RatingService,
    SignalService,
    TrustConsumers,
    { provide: TRUST_QUERY, useExisting: RatingService },
    { provide: REPORT_COMMANDS, useExisting: TrustReportService },
    { provide: CASE_QUERY, useExisting: TrustReportService },
    { provide: SANCTION_PORT, useExisting: SanctionService },
  ],
  exports: [SANCTION_PORT, TRUST_QUERY],
})
export class TrustModule {}
