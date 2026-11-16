import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { config, ConfigError } from './kernel/config/config';
import { JsonLogger } from './kernel/logging/json-logger';

// Bootstrap: the configuration is checked first, before anything connects (K-01, I-59); then the kernel
// and the unit modules (AppModule). Every log line, Nest's own included, is JSON (K-02, kernel/logging); lines
// written while the application starts are held until the logger is installed.
async function bootstrap() {
  let port: number;
  let logger: JsonLogger;
  try {
    ({ port } = config());
    logger = new JsonLogger(config().logLevel);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    // Names and reasons only; ConfigError never contains a value.
    new JsonLogger().fatal({ msg: 'configuration refused', problems: err.problems }, 'config');
    process.exit(1);
  }
  // rawBody: Stripe's webhook signature is over the exact bytes received (SEC-PAY-03)
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(logger);
  configureApp(app);
  await app.listen(port);
}

void bootstrap();
