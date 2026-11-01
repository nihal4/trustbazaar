import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { config, ConfigError } from './kernel/config/config';

// Bootstrap: the configuration is checked first, before anything connects (K-01, I-59); then the kernel
// and the unit modules (AppModule). Logging, the error format and graceful shutdown arrive with K-02,
// K-06 and U1-02.
async function bootstrap() {
  let port: number;
  try {
    port = config().port;
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // Names and reasons only; ConfigError never contains a value.
    console.error(JSON.stringify({ level: 'fatal', msg: 'configuration refused', problems: err.problems }));
    process.exit(1);
  }
  // rawBody: Stripe's webhook signature is over the exact bytes received (SEC-PAY-03)
  const app = configureApp(await NestFactory.create(AppModule, { rawBody: true }));
  await app.listen(port);
}

void bootstrap();
