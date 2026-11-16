import type { LoggerService, LogLevel as NestLevel } from '@nestjs/common';
import type { LogLevel } from '../config/config';
import { currentCorrelationId } from './context';
import { redact } from './redact';

// JSON logging (docs/design/09_integration.pdf section 8.3; NFR-OBS-02, SEC-DAT-07, DV-62; K-02). Nest's Logger, used
// by every unit as `new Logger('PaymentService')`, writes through this service once main.ts installs it: one JSON
// object per line to standard output with the time (UTC), level, module (the logger's context: the service or Nest
// component that wrote it), the message and the correlation id of the request or job in progress. Extra objects passed
// to the logger become fields. Everything goes through the redaction list first (redact.ts). Docker rotates the
// output (5 files of 50 MB per container).

const ORDER = ['error', 'warn', 'info', 'debug'] as const;
const LEVEL: Record<NestLevel, 'fatal' | 'error' | 'warn' | 'info' | 'debug'> = {
  fatal: 'fatal', error: 'error', warn: 'warn', log: 'info', debug: 'debug', verbose: 'debug',
};

export type LogLine = { time: string; level: string; module: string; msg: string; correlationId?: string } & Record<string, unknown>;

export class JsonLogger implements LoggerService {
  constructor(
    private readonly threshold: LogLevel = 'info',
    private readonly write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    private readonly now: () => Date = () => new Date(),
  ) {}

  log(message: unknown, ...rest: unknown[]) {
    this.emit('log', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.emit('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.emit('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.emit('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.emit('verbose', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.emit('fatal', message, rest);
  }

  enabled(level: NestLevel): boolean {
    const l = LEVEL[level];
    return l === 'fatal' || ORDER.indexOf(l) <= ORDER.indexOf(this.threshold);
  }

  /**
   * Nest calls log(message, context), error(message, stack, context) and passes extra arguments before the context;
   * the last string argument is the context. An object (or an Error) as the message or an argument becomes fields.
   */
  private emit(level: NestLevel, message: unknown, rest: unknown[]) {
    if (!this.enabled(level)) return;
    const args = [...rest];
    const module = typeof args[args.length - 1] === 'string' && args.length > 0 ? (args.pop() as string) : 'app';
    const fields: Record<string, unknown> = {};
    let msg: string;
    if (typeof message === 'string') msg = message;
    else if (message instanceof Error) {
      msg = message.message;
      fields.error = message;
    } else if (message && typeof message === 'object') {
      const { msg: m, message: mm, ...others } = message as Record<string, unknown>;
      msg = typeof m === 'string' ? m : typeof mm === 'string' ? mm : '';
      Object.assign(fields, others);
    } else msg = String(message);
    for (const a of args) {
      if (a instanceof Error) fields.error = a;
      else if (typeof a === 'string' && level === 'error') fields.stack = a; // Nest's error(message, stack, context)
      else if (a && typeof a === 'object') Object.assign(fields, a);
      else if (a !== undefined) fields.detail = a;
    }
    const correlationId = currentCorrelationId();
    const { time: _t, level: _l, module: _m, correlationId: _c, ...safe } = redact(fields) as Record<string, unknown>;
    const line: LogLine = {
      time: this.now().toISOString(), level: LEVEL[level], module, msg: redact(msg) as string,
      ...(correlationId ? { correlationId } : {}), ...safe,
    };
    this.write(JSON.stringify(line));
  }
}
