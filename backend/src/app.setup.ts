import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as cookieParser from 'cookie-parser';
import { config } from './kernel/config/config';
import { correlationMiddleware } from './kernel/http/correlation';
import { RedisIoAdapter } from './kernel/live/redis-io.adapter';
import { ProblemFilter } from './kernel/http/problem.filter';

// What every running backend gets on top of AppModule. Shared by main.ts and the API tests
// (test/support/app.ts), so the tests exercise the same pipeline as production.
export function configureApp(app: INestApplication): INestApplication {
  const express = app as NestExpressApplication;

  // One proxy hop: the web container's nginx appends the client's address to X-Forwarded-For, so
  // request.ip is the address nginx saw, which a client cannot forge (per-address rate limits).
  express.set('trust proxy', 1);

  // All paths are under /api/v1 (DC-3).
  app.setGlobalPrefix('api/v1');

  // A correlation id on every request and response (SEC-INP-06).
  app.use(correlationMiddleware);

  // Cookies carry the session (Unit 1 section 7.1); no token is read from anywhere else (SEC-SES-03).
  app.use(cookieParser());

  // DTOs with class-validator; unknown fields are rejected, not stripped (BUILDING.md section 4).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // Every error is an RFC 9457 problem document (DC-3).
  app.useGlobalFilters(new ProblemFilter());

  // The live connection at /socket.io: WebSocket only, our origin only, rooms across instances (K-07).
  app.useWebSocketAdapter(new RedisIoAdapter(app, config().publicOrigin));

  return app;
}
