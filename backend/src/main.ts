import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Bootstrap: the kernel first, then the unit modules (AppModule). Configuration, logging, health,
// the error format and graceful shutdown arrive with the kernel tasks (K-01 to K-07).
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // DTOs with class-validator; unknown fields are rejected, not stripped (BUILDING.md section 4).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
