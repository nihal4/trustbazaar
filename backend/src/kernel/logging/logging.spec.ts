import { Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { correlationMiddleware } from '../http/correlation';
import { currentCorrelationId, withCorrelation } from './context';
import { JsonLogger, LogLine } from './json-logger';
import { mask, REDACTED, redact } from './redact';

// K-02: the redaction list, the JSON line, levels, and the correlation id of the work in progress.
describe('redaction (SEC-DAT-07)', () => {
  it('SEC-DAT-07 the keys of the redaction list are removed at any depth, also inside longer keys', () => {
    const out = redact({
      password: 'hunter2', otp: '123456', sessionToken: 'abc', 'set-cookie': 'tb=1', Authorization: 'Bearer x', nid: '1990123',
      payout: { accountNumber: '0123456789', account_number: '987', bank: 'City' }, ciphertext: 'AAAA', credentials: { user: 'u' },
      list: [{ refreshToken: 't' }], ok: 'value', n: 3, big: 5n, when: new Date('2026-11-17T00:00:00Z'), raw: Buffer.from('abc'),
    }) as Record<string, unknown>;
    expect(out).toEqual({
      password: REDACTED, otp: REDACTED, sessionToken: REDACTED, 'set-cookie': REDACTED, Authorization: REDACTED, nid: REDACTED,
      payout: { accountNumber: REDACTED, account_number: REDACTED, bank: 'City' }, ciphertext: REDACTED, credentials: REDACTED,
      list: [{ refreshToken: REDACTED }], ok: 'value', n: 3, big: '5', when: '2026-11-17T00:00:00.000Z', raw: '[3 bytes]',
    });
  });

  it('SEC-DAT-07 phone numbers and e-mail addresses are masked to their last characters; other numbers are kept', () => {
    expect(mask('sms to +8801711000002 and 01811000345 or 8801911000777')).toBe('sms to ***002 and ***345 or ***777');
    expect(mask('mail rahim.uddin@example.com.bd')).toBe('mail ***in@example.com.bd');
    expect(mask('took 1793491200002 ms, order 42, id 00000000-0000-4000-8000-000000000002')).toBe('took 1793491200002 ms, order 42, id 00000000-0000-4000-8000-000000000002');
  });

  it('SEC-DAT-07 errors keep name, masked message and stack; cycles and depth are bounded', () => {
    const e = new Error('no account for a@bc.com');
    expect(redact(e)).toMatchObject({ name: 'Error', message: 'no account for ***a@bc.com', stack: expect.stringContaining('***a@bc.com') });
    const a: Record<string, unknown> = { x: 1 };
    a.self = a;
    expect(redact(a)).toEqual({ x: 1, self: '[circular]' });
    expect(redact({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toEqual({ a: { b: { c: { d: { e: { f: '[nested]' } } } } } });
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });
});

describe('JsonLogger (NFR-OBS-02)', () => {
  const NOW = new Date('2026-11-17T08:00:00Z');
  const capture = (level: 'error' | 'warn' | 'info' | 'debug' = 'info') => {
    const lines: LogLine[] = [];
    return { lines, logger: new JsonLogger(level, (l) => lines.push(JSON.parse(l)), () => NOW) };
  };

  it('NFR-OBS-02 one JSON line with time, level, module, message and the correlation id; fields are redacted', () => {
    const { lines, logger } = capture();
    logger.log('payment attempt failed', 'PaymentService');
    withCorrelation('11111111-1111-4111-8111-111111111111', () => logger.warn({ msg: 'refund retry', refundId: 'r1', token: 'secret' }, 'RefundService'));
    logger.error('boom for +8801711000002', 'Error: stack at x', 'ProblemFilter');
    logger.log({ message: 'from message', time: 'forged', level: 'forged' });
    logger.fatal(new Error('down'), 'config');
    logger.verbose('detail', 'X');
    expect(lines).toEqual([
      { time: '2026-11-17T08:00:00.000Z', level: 'info', module: 'PaymentService', msg: 'payment attempt failed' },
      { time: '2026-11-17T08:00:00.000Z', level: 'warn', module: 'RefundService', msg: 'refund retry', correlationId: '11111111-1111-4111-8111-111111111111', refundId: 'r1', token: REDACTED },
      { time: '2026-11-17T08:00:00.000Z', level: 'error', module: 'ProblemFilter', msg: 'boom for ***002', stack: 'Error: stack at x' },
      { time: '2026-11-17T08:00:00.000Z', level: 'info', module: 'app', msg: 'from message' },
      { time: '2026-11-17T08:00:00.000Z', level: 'fatal', module: 'config', msg: 'down', error: expect.objectContaining({ name: 'Error', message: 'down' }) },
    ]);
  });

  it('NFR-OBS-02 the level threshold of LOG_LEVEL; fatal is always written; extra arguments become fields', () => {
    const { lines, logger } = capture('warn');
    logger.log('hidden', 'A');
    logger.debug('hidden', 'A');
    logger.warn('kept', { orderId: 'o1' }, 7, new Error('cause'), 'A');
    logger.fatal('always', 'A');
    expect(lines.map((l) => l.msg)).toEqual(['kept', 'always']);
    expect(lines[0]).toMatchObject({ orderId: 'o1', detail: 7, error: { message: 'cause' } });
    const dbg = capture('debug');
    dbg.logger.debug(42);
    expect(dbg.lines[0]).toMatchObject({ level: 'debug', module: 'app', msg: '42' });
    expect(capture('error').logger.enabled('warn')).toBe(false);
  });

  it('NFR-OBS-02 Nest\'s Logger in any service writes through the installed logger', () => {
    const { lines, logger } = capture();
    Logger.overrideLogger(logger);
    try {
      new Logger('OrdersJobs').warn('job slow');
    } finally {
      Logger.overrideLogger(false);
    }
    expect(lines).toEqual([expect.objectContaining({ module: 'OrdersJobs', msg: 'job slow', level: 'warn' })]);
  });
});

describe('correlation (SEC-INP-06, NFR-OBS-02)', () => {
  it('SEC-INP-06 the request\'s id is current while it is handled and on its one access line, without the query', () => {
    const lines: LogLine[] = [];
    Logger.overrideLogger(new JsonLogger('info', (l) => lines.push(JSON.parse(l))));
    try {
      const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader: jest.fn() });
      const req = { method: 'GET', originalUrl: '/api/v1/callbacks/bkash/a?state=SECRET', header: () => 'AAAAAAAA-1111-4111-8111-111111111111' };
      let inside: string | undefined;
      correlationMiddleware(req as never, res as never, () => {
        inside = currentCorrelationId();
      });
      expect(inside).toBe('aaaaaaaa-1111-4111-8111-111111111111');
      res.emit('finish');
      const failed = Object.assign(new EventEmitter(), { statusCode: 503, setHeader: jest.fn() });
      correlationMiddleware({ ...req, header: () => 'not-a-uuid' } as never, failed as never, () => undefined);
      failed.emit('finish');
    } finally {
      Logger.overrideLogger(false);
    }
    expect(lines[0]).toMatchObject({ module: 'http', msg: 'request', level: 'info', method: 'GET', path: '/api/v1/callbacks/bkash/a', status: 200, correlationId: 'aaaaaaaa-1111-4111-8111-111111111111' });
    expect(JSON.stringify(lines)).not.toContain('SECRET');
    expect(lines[1]).toMatchObject({ level: 'warn', status: 503, correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(lines[1].correlationId).not.toBe('not-a-uuid');
    expect(currentCorrelationId()).toBeUndefined();
  });
});
