import { Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { REDIS, redisProvider } from './redis.provider';

// The shared kernel (docs/design/09_integration.pdf, section 2): configuration and secrets (K-01),
// logging (K-02), health (K-03), the outbox dispatcher (K-04), the job runner (K-05), metrics and
// shutdown (K-06), the Socket.IO gateway (K-07) and the problem+json error format.
// The kernel never imports a unit module; units import the kernel.
//
// The database connection is tb_app's (DATABASE_URL); the schema is changed only by the migrations,
// never synchronised (SEC-INF-03, SEC-INF-05). Units add their entities with TypeOrmModule.forFeature.
// DATABASE_URL and REDIS_URL come from the environment until K-01 adds the configuration module.
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is required');
        return { type: 'postgres', url, autoLoadEntities: true, synchronize: false, migrationsRun: false };
      },
    }),
  ],
  controllers: [HealthController],
  providers: [redisProvider, HealthService],
  exports: [REDIS],
})
export class KernelModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }
}
