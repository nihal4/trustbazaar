import { ReportService } from './report.service';

// U6-03: what ReportService hands to Unit 7's ReportCommands once it exists (U7-04), with the database faked.
const THREAD = 't0000000-0000-4000-8000-000000000001';
const BUYER = 'b0000000-0000-4000-8000-000000000001';
const SELLER = 's0000000-0000-4000-8000-000000000001';

function setup(o: { commands?: boolean } = {}) {
  const db = {
    query: jest.fn(async (sql: string, p: unknown[]) => {
      if (sql.includes('FROM chat.threads')) return [{ buyer_id: BUYER, seller_id: SELLER }];
      if (sql.includes('FROM chat.messages')) return p[1] === 1 ? [{ id: '41', sender_id: SELLER }] : p[1] === 2 ? [{ id: '42', sender_id: BUYER }] : [];
      return [];
    }),
  };
  const commands = { report: jest.fn(async () => 'r-1') };
  const modules = {
    get: jest.fn(() => {
      if (o.commands === false) throw new Error('not found');
      return commands;
    }),
  };
  const limiter = { consume: jest.fn(async () => undefined) };
  return { svc: new ReportService(db as never, modules as never, limiter as never), commands, limiter };
}

describe('ReportService', () => {
  it('FR-CHT-06 a reported message goes to ReportCommands with the thread, the message id and the other participant', async () => {
    const { svc, commands, limiter } = setup();
    expect(await svc.report(BUYER, THREAD, { category: 'fraudulent', messageSeq: 1, text: '  Asked to pay outside.  ' })).toEqual({ reportId: 'r-1' });
    expect(commands.report).toHaveBeenCalledWith({
      reporterId: BUYER, category: 'fraudulent', text: 'Asked to pay outside.',
      target: { type: 'message', id: THREAD, messageId: '41', subjectUserId: SELLER },
    });
    expect(limiter.consume).toHaveBeenCalledWith('chat-report', `user:${BUYER}`);
  });

  it('FR-CHT-06 a reported thread is about the other participant', async () => {
    const { svc, commands } = setup();
    await svc.report(SELLER, THREAD, { category: 'abusive' });
    expect(commands.report).toHaveBeenCalledWith({ reporterId: SELLER, category: 'abusive', text: undefined, target: { type: 'thread', id: THREAD, subjectUserId: BUYER } });
  });

  it('FR-CHT-06 own messages, unknown messages and outsiders are refused before any limit is used', async () => {
    const { svc, limiter } = setup();
    await expect(svc.report(BUYER, THREAD, { category: 'abusive', messageSeq: 2 })).rejects.toMatchObject({ problem: 'validation-failed' });
    await expect(svc.report(BUYER, THREAD, { category: 'abusive', messageSeq: 7 })).rejects.toMatchObject({ problem: 'not-found' });
    await expect(svc.report('x0000000-0000-4000-8000-000000000001', THREAD, { category: 'abusive' })).rejects.toMatchObject({ problem: 'not-found' });
    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('FR-CHT-06 without Unit 7 the answer is feature-off and no limit is used', async () => {
    const { svc, limiter } = setup({ commands: false });
    await expect(svc.report(BUYER, THREAD, { category: 'abusive' })).rejects.toMatchObject({
      problem: 'feature-off', extra: { errors: [{ field: 'report', reason: 'reports-not-yet-available' }] },
    });
    expect(limiter.consume).not.toHaveBeenCalled();
  });
});
