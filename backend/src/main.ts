import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

// Bootstrap: the kernel first, then the unit modules (AppModule). Configuration, logging, the error
// format and graceful shutdown arrive with the kernel tasks (K-01 to K-07).
async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
