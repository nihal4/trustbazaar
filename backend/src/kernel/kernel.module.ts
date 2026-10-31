import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { config } from './config/config';
import { configProvider, TB_CONFIG } from './config/config.provider';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { REDIS, redisProvider } from './redis.provider';

// The shared kernel (docs/design/09_integration.pdf, section 2): configuration and secrets (K-01),
// logging (K-02), health (K-03), the outbox dispatcher (K-04), the job runner (K-05), metrics and
// shutdown (K-06), the Socket.IO gateway (K-07) and the problem+json error format.
// The kernel never imports a unit module; units import the kernel. It is global, so every unit can
// inject TB_CONFIG and REDIS without importing it.
//
// The database connection is tb_app's (DATABASE_URL); the schema is changed only by the migrations,
// never synchronised (SEC-INF-03, SEC-INF-05). Units add their entities with TypeOrmModule.forFeature.
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: 'postgres',
        url: config().databaseUrl.reveal(),
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
      }),
    }),
  ],
  controllers: [HealthController],
  providers: [configProvider, redisProvider, HealthService],
  exports: [TB_CONFIG, REDIS],
})
export class KernelModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
