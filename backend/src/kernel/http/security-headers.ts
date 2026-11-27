import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

// Shared security middleware (docs/design/01_identity_access.pdf DC-11; SEC-WEB-01 to SEC-WEB-03, SEC-DAT-01; U1-11).
// The web container sets the headers of the four HTML documents (docs/design/08_frontend.pdf section 9.1); the
// backend sets its own on every API response, which are JSON, images or the mock providers' pages:
//  - CSP default-src 'none' with frame-ancestors 'none': an API response loads nothing and is framed nowhere. A page
//    the backend serves itself (the mock payment and courier pages) sets its own stricter-than-needed policy on the
//    response, which replaces this one.
//  - X-Content-Type-Options nosniff, Referrer-Policy no-referrer, Cross-Origin-Opener-Policy and -Resource-Policy
//    same-origin, X-Frame-Options DENY for old browsers; no X-Powered-By.
//  - Permissions-Policy: every powerful feature off; the camera and geolocation are allowed only by the documents that
//    need them (the KYC page and the user app), whose headers the web container sets (SEC-WEB-02).
//  - HSTS for a year with subdomains in production only (the TLS front sets it too, Unit 9); never over plain HTTP in
//    development, where it would pin localhost to HTTPS.
//  - CORS (SEC-WEB-03): only PUBLIC_ORIGIN, the web client's origin, with credentials (the session cookie). Any other
//    origin gets no Access-Control-Allow-Origin, so the browser refuses it the response; a preflight from it is refused.

export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'bluetooth=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
].join(', ');

export function securityHeaders(production: boolean) {
  const h = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    strictTransportSecurity: production ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    h(req, res, next);
  };
}

export function enableCors(app: INestApplication, webOrigin: string): void {
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, origin === undefined || origin === webOrigin),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'X-CSRF-Token', 'X-Step-Up', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id', 'Retry-After'],
    maxAge: 600,
  });
}
