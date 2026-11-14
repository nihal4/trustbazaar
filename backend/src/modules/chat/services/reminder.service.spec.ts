import { ReminderService } from './reminder.service';

// U6-06 with the database, Unit 2 and the notices faked: what scheduling, cancelling and the job do with each row.
// The same against PostgreSQL: test/api/reminders.spec.ts.

const NOW = new Date('2026-12-01T10:00:00Z');
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms);

type Claimed = { id: string; user_id: string; kind: string; subject_id: string; due_at: Date; lead_s: number; lead_text: string };
type Create = (userId: string, code: string, params: unknown, key: string, subject: unknown) => Promise<string | null>;
function setup(o: { claimed?: Claimed[]; deadline?: (orderId: string) => unknown } = {}) {
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('claim_due_reminders')) return o.claimed ?? [];
    if (sql.includes('cancel_reminders')) return [{ n: 2 }];
    return [];
  });
  const notices = { create: jest.fn<ReturnType<Create>, Parameters<Create>>(async () => 'N1'), push: jest.fn(async (_u: string, _id: string) => undefined) };
  const deadlines = { deadline: jest.fn(async (id: string) => { const d = o.deadline?.(id); if (d instanceof Error) throw d; return d ?? null; }) };
  const params = { current: async () => ({ get: () => ({ reminders: ['24 hours', '2 hours'] }) }) };
  const svc = new ReminderService({ query } as never, notices as never, deadlines as never, params as never, { now: () => NOW });
  const sql = (part: string) => query.mock.calls.filter(([q]) => String(q).includes(part)).map(([, p]) => p);
  return { svc, query, notices, deadlines, sql };
}
const claimed = (id: string, dueAt: Date, kind = 'meetup_handover'): Claimed =>
  ({ id, user_id: `U-${id}`, kind, subject_id: `O-${id}`, due_at: dueAt, lead_s: 7200, lead_text: '02:00:00' });

describe('ReminderService', () => {
  it('FR-NTF-07 CP-38 schedules one reminder per lead and person; a lead whose time has passed is skipped', async () => {
    const s = setup();
    expect(await s.svc.schedule(['B', 'S', 'B'], 'meetup_handover', 'O1', at(3 * 24 * HOUR))).toBe(4);
    expect(s.sql('schedule_reminder')).toEqual([
      ['B', 'meetup_handover', 'O1', at(72 * HOUR), '24 hours'], ['S', 'meetup_handover', 'O1', at(72 * HOUR), '24 hours'],
      ['B', 'meetup_handover', 'O1', at(72 * HOUR), '2 hours'], ['S', 'meetup_handover', 'O1', at(72 * HOUR), '2 hours'],
    ]);
    const near = setup();
    expect(await near.svc.schedule(['S'], 'courier_pickup', 'O2', at(5 * HOUR))).toBe(1); // 24 hours before is already past
    expect(await near.svc.schedule(['S'], 'courier_pickup', 'O3', at(HOUR))).toBe(0);
  });

  it('FR-NTF-07 cancelling counts the reminders cancelled for every kind', async () => {
    const s = setup();
    expect(await s.svc.cancel(['payment_window', 'dispute_window'], 'O1')).toBe(4);
    expect(s.sql('cancel_reminders')).toEqual([['payment_window', 'O1'], ['dispute_window', 'O1']]);
  });

  it('FR-NTF-07 the job sends what still applies, drops what does not, re-arms a deadline moved later, and puts a failure back', async () => {
    const s = setup({
      claimed: [
        claimed('sent', at(HOUR)), claimed('gone', at(HOUR)), claimed('passed', at(HOUR)), claimed('later', at(HOUR)),
        claimed('earlier', at(HOUR)), claimed('failing', at(HOUR)), claimed('query-error', at(HOUR)),
      ],
      deadline: (id) => ({
        'O-sent': { dueAt: at(HOUR), listingTitle: 'Fridge' },
        'O-gone': null, // the step happened, the cancellation never arrived
        'O-passed': { dueAt: at(-1000), listingTitle: 'Fridge' },
        'O-later': { dueAt: at(5 * HOUR), listingTitle: 'Fridge' },
        'O-earlier': { dueAt: at(HOUR / 2), listingTitle: null },
        'O-failing': { dueAt: at(HOUR), listingTitle: 'Fridge' },
        'O-query-error': new Error('database gone'),
      })[id],
    });
    s.notices.create.mockImplementation(async (userId: string) => {
      if (userId === 'U-failing') throw new Error('template missing');
      return userId === 'U-earlier' ? null : 'N1'; // null: made by an earlier run (dedupe key)
    });
    expect(await s.svc.sendDue()).toEqual({ sent: 2, dropped: 2, moved: 1, failed: 2 });
    expect(s.notices.create.mock.calls.map((c) => [c[0], c[1], c[2], c[3]])).toEqual([
      ['U-sent', 'reminder.meetup_handover', { listing_title: 'Fridge', hours: 2 }, `reminder:sent:${at(HOUR).toISOString()}`],
      ['U-earlier', 'reminder.meetup_handover', { listing_title: '—', hours: 2 }, `reminder:earlier:${at(HOUR / 2).toISOString()}`],
      ['U-failing', 'reminder.meetup_handover', { listing_title: 'Fridge', hours: 2 }, `reminder:failing:${at(HOUR).toISOString()}`],
    ]);
    expect(s.notices.push.mock.calls).toEqual([['U-sent', 'N1']]);
    expect(s.sql("SET status = 'cancelled'")).toEqual([['gone'], ['passed']]);
    expect(s.sql('schedule_reminder')).toEqual([
      ['U-later', 'meetup_handover', 'O-later', at(5 * HOUR), '02:00:00'], ['U-earlier', 'meetup_handover', 'O-earlier', at(HOUR / 2), '02:00:00'],
    ]);
    expect(s.sql("SET status = 'scheduled'")).toEqual([['failing'], ['query-error']]);
    expect(s.sql('claim_due_reminders')).toEqual([[100]]);
  });
});
