import type { NextFunction, Request, Response } from 'express';
import { Counter, Histogram, Registry } from 'prom-client';

// The backend's metrics (docs/design/09_integration.pdf section 8.3; NFR-OBS-03, DV-63, SEC-LOG-05; K-06), in one
// registry served in Prometheus format on the internal metrics port (MetricsService). The counters below are written
// where the events happen; the gauges of WebSocket connections, outboxes and jobs are read when Prometheus scrapes.
// Labels never carry personal data: routes are the matched route pattern, never the path with its ids.
export const registry = new Registry();

// ---------------------------------------------------------------- requests (NFR-OBS-03)
const requests = new Counter({
  name: 'tb_http_requests_total',
  help: 'API requests by route, method and status class',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
});
const latency = new Histogram({
  name: 'tb_http_request_duration_seconds',
  help: 'API request duration by route and method',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/** The matched route pattern ('/api/v1/orders/:id'); 'unmatched' for a 404 without a route. */
function routeOf(req: Request): string {
  const r = (req as Request & { route?: { path?: string } }).route?.path;
  return typeof r === 'string' ? `${req.baseUrl}${r}` : 'unmatched';
}

export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const end = latency.startTimer();
  res.on('finish', () => {
    const route = routeOf(req);
    end({ method: req.method, route });
    requests.inc({ method: req.method, route, status: `${Math.floor(res.statusCode / 100)}xx` });
  });
  next();
}

// ---------------------------------------------------------------- provider adapters (NFR-OBS-03)
export const providerErrors = new Counter({
  name: 'tb_provider_errors_total',
  help: 'Errors from payment, payout and courier provider adapters',
  labelNames: ['provider', 'operation'],
  registers: [registry],
});

// ---------------------------------------------------------------- SEC-LOG-05 alert events
export const securityEvents = {
  signinFailed: new Counter({
    name: 'tb_signin_failures_total',
    help: 'Failed sign-ins (SEC-LOG-05: alert on a spike)',
    labelNames: ['kind'],
    registers: [registry],
  }),
  otpSent: new Counter({
    name: 'tb_otp_sent_total',
    help: 'One-time codes sent (SEC-LOG-05: alert above normal volume)',
    labelNames: ['purpose'],
    registers: [registry],
  }),
  kycViews: new Counter({
    name: 'tb_kyc_views_total',
    help: 'KYC records viewed by staff, per staff account (SEC-LOG-05: alert on many in a short time)',
    labelNames: ['staff'],
    registers: [registry],
  }),
  auditChainBreaks: new Counter({
    name: 'tb_audit_chain_breaks_total',
    help: 'Breaks found in the audit-log hash chain (SEC-LOG-05: alert on any)',
    registers: [registry],
  }),
  webhookSignatureFailures: new Counter({
    name: 'tb_webhook_signature_failures_total',
    help: 'Webhooks refused for their signature (SEC-LOG-05: alert when repeated)',
    labelNames: ['provider'],
    registers: [registry],
  }),
  escrowRejected: new Counter({
    name: 'tb_escrow_transitions_rejected_total',
    help: 'Escrow changes refused by the database (SEC-LOG-05: alert on any)',
    registers: [registry],
  }),
};

const ESCROW_REFUSALS = [/escrow .+ -> .+ is not permitted/, /escrow is terminal/, /escrow must start in held/, /amount_collected is fixed/];

/** Counts an error that is the database refusing an escrow change (orders.check_escrow_transition). */
export function noteDatabaseError(err: unknown): void {
  const message = (err as { driverError?: { message?: string }; message?: string } | null)?.driverError?.message ?? (err as Error | null)?.message ?? '';
  if (ESCROW_REFUSALS.some((r) => r.test(message))) securityEvents.escrowRejected.inc();
}
