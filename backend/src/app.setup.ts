import { INestApplication, ValidationPipe } from '@nestjs/common';

// What every running backend gets on top of AppModule. Shared by main.ts and the API tests
// (test/support/app.ts), so the tests exercise the same pipeline as production.
export function configureApp(app: INestApplication): INestApplication {
  // All paths are under /api/v1 (DC-3).
  app.setGlobalPrefix('api/v1');

  // DTOs with class-validator; unknown fields are rejected, not stripped (BUILDING.md section 4).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  return app;
}
