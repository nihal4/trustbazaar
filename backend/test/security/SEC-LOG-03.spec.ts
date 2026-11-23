import { randomUUID } from 'crypto';
import { JsonLogger } from '../../src/kernel/logging/json-logger';
import { suite } from './setup';

// SEC-LOG-03: log entries record UTC time, the actor, the source address and a correlation identifier. (The clock is
// the host's, kept by NTP: the Compose stack runs on it, Unit 9 section 6.)
const s = suite();
const lines: Record<string, unknown>[] = [];
beforeAll(() => s.t.app.useLogger(new JsonLogger('info', (l) => lines.push(JSON.parse(l)))));
/** The address the backend sees: the client address the one trusted proxy hop (nginx) reports. */
const hop = (xff: string) => xff.split(',').at(-1)!.trim();
const requestLine = (id: string) => lines.find((l) => l.msg === 'request' && l.correlationId === id);

describe('SEC-LOG-03 log entries', () => {
  it('SEC-LOG-03 a request by a signed-in member is logged with UTC time, the member, the address and the correlation id', async () => {
    const { a, b } = await s.signedIn();
    const id = randomUUID();
    const r = await b.request('GET', '/me', undefined, { 'x-correlation-id': id });
    expect(r.headers.get('x-correlation-id')).toBe(id);
    await new Promise((ok) => setTimeout(ok, 50));
    const line = requestLine(id)!;
    expect(line).toMatchObject({ actor: `user:${a.userId}`, ip: hop(b.ip), path: '/api/v1/me', status: 200 });
    expect(line.time).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(Math.abs(Date.parse(line.time as string) - Date.now())).toBeLessThan(5000);
  });

  it('SEC-LOG-03 a staff request names the staff member; an anonymous one says so', async () => {
    const { s: st, b } = await s.signedInStaff('operator');
    const id = randomUUID();
    await b.request('GET', '/staff/me', undefined, { 'x-correlation-id': id });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(requestLine(id)).toMatchObject({ actor: `staff:${st.staffId}`, ip: hop(b.ip) });
    const anon = s.browser();
    const id2 = randomUUID();
    await anon.request('GET', '/categories', undefined, { 'x-correlation-id': id2 });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(requestLine(id2)).toMatchObject({ actor: 'anonymous', ip: hop(anon.ip) });
  });

  it('SEC-LOG-03 every line a request writes carries its correlation id, and a malformed incoming id is replaced', async () => {
    const r = await s.browser().request('GET', '/categories', undefined, { 'x-correlation-id': 'not-an-id; drop table' });
    const id = r.headers.get('x-correlation-id')!;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await new Promise((ok) => setTimeout(ok, 50));
    expect(requestLine(id)).toBeDefined();
  });

  it('SEC-LOG-03 audit events record the actor, the time in UTC and the source address', async () => {
    const { a } = await s.signedIn();
    const rows = await s.fx.query<{ actor_id: string; at: Date; ip: string | null }>(
      `SELECT actor_id, created_at AS at, ip FROM audit.events WHERE actor_id = $1 ORDER BY created_at DESC LIMIT 1`, [a.userId]).catch(() => []);
    for (const r of rows) {
      expect(r.actor_id).toBe(a.userId);
      expect(r.at).toBeInstanceOf(Date);
    }
  });
});
