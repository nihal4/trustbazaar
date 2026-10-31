import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProblemFilter } from './problem.filter';
import { Problem } from './problems';

function run(error: unknown) {
  const headers: Record<string, string> = {};
  const out: { status?: number; type?: string; body?: Record<string, unknown> } = {};
  const res = {
    setHeader: (k: string, v: string) => (headers[k] = v),
    status: (s: number) => ((out.status = s), res),
    type: (t: string) => ((out.type = t), res),
    json: (b: Record<string, unknown>) => (out.body = b),
  };
  const host = { switchToHttp: () => ({ getRequest: () => ({ correlationId: 'cid-1' }), getResponse: () => res }) };
  new ProblemFilter().catch(error, host as never);
  return { ...out, headers };
}

describe('problem documents', () => {
  it('SEC-INP-06 a Problem becomes an RFC 9457 document with type, title, status and correlation id', () => {
    const r = run(new Problem('step-up-required'));
    expect(r.status).toBe(403);
    expect(r.type).toBe('application/problem+json');
    expect(r.body).toEqual({
      type: '/problems/step-up-required', title: 'Please confirm it is you to continue.', status: 403, correlationId: 'cid-1',
    });
  });

  it('SEC-ABU-01 a rate-limited problem carries Retry-After', () => {
    const r = run(new Problem('rate-limited', { retryAfter: 42 }));
    expect(r.status).toBe(429);
    expect(r.headers['Retry-After']).toBe('42');
  });

  it('SEC-INP-06 an unexpected error gives a generic 500 and never its message', () => {
    const r = run(new Error('connection to db at 10.0.0.5 failed: password authentication failed for tb_app'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/10\.0\.0\.5|tb_app|password/);
    expect(r.body).toMatchObject({ type: '/problems/internal', correlationId: 'cid-1' });
  });

  it('SEC-INP-06 validation errors list the rules that failed', () => {
    const r = run(new BadRequestException(['property extra should not exist']));
    expect(r.body).toMatchObject({ type: '/problems/validation-failed', status: 400, errors: ['property extra should not exist'] });
  });

  it('SEC-INP-06 a framework 404 becomes the not-found problem', () => {
    expect(run(new NotFoundException('Cannot GET /api/v1/x')).body).toMatchObject({ type: '/problems/not-found', status: 404 });
  });
});
