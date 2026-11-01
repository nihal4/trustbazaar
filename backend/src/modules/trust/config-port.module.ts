import { Global, Module } from '@nestjs/common';
import { CONFIG_PORT } from '../../kernel/config-port';
import { ConfigService } from './services/config.service';

// Unit 7 provides ConfigPort to every unit (DC-9). It is global, like the kernel, because every unit reads
// parameters; it depends on nothing but the database and the clock, so no unit's module order matters.
@Global()
@Module({
  providers: [ConfigService, { provide: CONFIG_PORT, useExisting: ConfigService }],
  exports: [CONFIG_PORT, ConfigService],
})
export class ConfigPortModule {}
