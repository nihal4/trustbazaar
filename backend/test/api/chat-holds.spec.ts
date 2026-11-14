import { randomInt, randomUUID } from 'crypto';
import { CHAT_COMMANDS, ChatCommands } from '../../src/modules/chat/ports';
import { HoldService } from '../../src/modules/chat/services/hold.service';
import { startApp, TestApp } from '../support/app';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U6-03: holds, the staff read through a held case, reports from chat, the detection terms and chat retention,
// against PostgreSQL and Redis (docs/design/06_chat_notifications.pdf sections 3.1, 3.3, 6.4 to 6.6).

describe('chat holds, staff read, reports, detection terms and retention', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let category: number;
  let commands: ChatCommands;

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    commands = t.app.get<ChatCommands>(CHAT_COMMANDS);
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`,
      [`holds-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    await fx?.close();
    await t?.close();
  });

  async function member() {
    const userId = await fx.user();
    const sid = await fx.session({ userId });
    const ip = `203.0.113.${randomInt(1, 255)}, 198.51.100.${randomInt(1, 255)}`;
    const headers = { ...fx.headers(sid, userId, 'user'), 'x-forwarded-for': ip };
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const send = (thread: string, text: string) => call('POST', `/threads/${thread}/messages`, { clientId: randomUUID(), text });
    const image = async (thread: string) => {
      const form = new FormData();
      form.set('clientId', randomUUID());
      const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#a77' } }).jpeg().toBuffer();
      form.set('image', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'i.jpg');
      return fetch(t.url(`/threads/${thread}/images`), { method: 'POST', headers, body: form });
    };
    return { userId, call, send, image };
  }
  async function operator(role: 'operator' | 'administrator' = 'operator') {
    const staffId = await fx.staff(role);
    const sid = await fx.session({ staffId });
    const headers = fx.headers(sid, staffId, 'staff');
    const call = (method: string, path: string, body?: unknown) =>
      fetch(t.url(path), {
        method, headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { staffId, call };
  }
  async function listing(sellerId: string) {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Phone for the hold tests', 'A phone in good condition, written by the hold tests.', 'used', true,
          'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, 1, 1) RETURNING id`,
      [sellerId, category],
    );
    for (const n of [1, 2]) {
      await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
    }
    await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    return id;
  }
  async function pair() {
    const [seller, buyer] = [await member(), await member()];
    const listingId = await listing(seller.userId);
    const r = await buyer.call('POST', `/listings/${listingId}/threads`);
    const { id } = (await r.json()) as { id: string };
    return { seller, buyer, listingId, thread: id };
  }
  const logged = async (thread: string) =>
    (await fx.query<{ n: string }>(`SELECT count(*)::text AS n FROM chat.staff_access_log WHERE thread_id = $1`, [thread]))[0].n;

  it('FR-CHT-10 an operator reads a thread only through a live hold of that case; each read is logged', async () => {
    const { seller, buyer, listingId, thread } = await pair();
    await buyer.send(thread, 'Is the screen original?');
    await seller.send(thread, 'Yes, never replaced.');
    await buyer.image(thread);
    expect(await commands.threadFor(listingId, buyer.userId)).toBe(thread);
    expect(await commands.threadFor(listingId, seller.userId)).toBeNull();

    const op = await operator();
    // a report on the thread, claimed by this operator (U7-04: only the case's operator reads through it)
    const [{ id: caseId }] = await fx.query<{ id: string }>(
      `INSERT INTO trust.reports (reporter_id, target_type, target_id, subject_user, category, status, assigned_to)
       VALUES ($1, 'thread', $2, $3, 'abusive', 'under_review', $4) RETURNING id`, [buyer.userId, thread, seller.userId, op.staffId]);
    const path = `/staff/cases/report/${caseId}/threads/${thread}`;
    expect((await op.call('GET', path)).status).toBe(404); // no hold yet
    await commands.hold(thread, 'report', caseId);
    await commands.hold(thread, 'report', caseId); // idempotent

    const r = await op.call('GET', path);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { buyer: { displayName: string }; messages: { seq: number; from: string; text: string | null; image: { url: string } | null }[] };
    expect(body.messages.map((m) => [m.seq, m.from, m.text])).toEqual([[1, 'buyer', 'Is the screen original?'], [2, 'seller', 'Yes, never replaced.'], [3, 'buyer', null]]);
    expect(body.messages[2].image?.url).toMatch(/^\/api\/v1\/files\/v\//);
    expect(Object.keys(body.buyer).sort()).toEqual(['displayName', 'verified']);
    expect(await logged(thread)).toBe('1');

    // another case, the other case type, a user, and the case after release: refused
    expect((await op.call('GET', `/staff/cases/report/${randomUUID()}/threads/${thread}`)).status).toBe(404);
    expect((await op.call('GET', `/staff/cases/dispute/${caseId}/threads/${thread}`)).status).toBe(404);
    expect((await op.call('GET', `/staff/cases/order/${caseId}/threads/${thread}`)).status).toBe(404);
    expect((await (await operator()).call('GET', path)).status).toBe(404); // another operator, who has not claimed it
    expect((await buyer.call('GET', path)).status).toBe(401); // a user has no staff session
    await commands.release(thread, 'report', caseId);
    expect((await op.call('GET', path)).status).toBe(404);
    expect(await logged(thread)).toBe('1');
  });

  it('FR-CHT-06 FR-TNS-01 a participant reports a message into Unit 7\'s queue, which holds the thread; once per message; others cannot report', async () => {
    const { seller, buyer, thread } = await pair();
    await seller.send(thread, 'Pay me outside the app.');
    await buyer.send(thread, 'No thanks.');
    const sent = await buyer.call('POST', `/threads/${thread}/reports`, { category: 'fraudulent', messageSeq: 1, text: 'Asked to pay outside.' });
    expect(sent.status).toBe(201);
    const { reportId } = (await sent.json()) as { reportId: string };
    const [report] = await fx.query<{ target_type: string; subject_user: string; status: string; message_id: string }>(
      `SELECT target_type, subject_user, status, message_id::text FROM trust.reports WHERE id = $1`, [reportId]);
    expect(report).toMatchObject({ target_type: 'message', subject_user: seller.userId, status: 'open' });
    expect(await fx.query(`SELECT case_type FROM chat.thread_holds WHERE thread_id = $1 AND case_id = $2 AND released_at IS NULL`, [thread, reportId])).toEqual([{ case_type: 'report' }]);
    const again = await buyer.call('POST', `/threads/${thread}/reports`, { category: 'abusive', messageSeq: 1 });
    expect(again.status).toBe(400);
    expect((await again.json()).errors).toEqual([{ field: 'target', reason: 'already-reported' }]);

    expect((await buyer.call('POST', `/threads/${thread}/reports`, { category: 'abusive', messageSeq: 2 })).status).toBe(400); // own message
    expect((await buyer.call('POST', `/threads/${thread}/reports`, { category: 'abusive', messageSeq: 9 })).status).toBe(404);
    expect((await buyer.call('POST', `/threads/${thread}/reports`, { category: 'rude' })).status).toBe(400);
    const stranger = await member();
    expect((await stranger.call('POST', `/threads/${thread}/reports`, { category: 'abusive' })).status).toBe(404);
  });

  it('FR-CHT-07 operators list, add and remove detection terms; a new term flags new messages; each change is audited', async () => {
    const op = await operator();
    const word = `zx${randomInt(1000, 9999)}chat`;
    const added = await op.call('POST', '/staff/chat/detection-terms', { term: `  ${word.toUpperCase()}  `, flag: 'off_platform_app' });
    expect(added.status).toBe(201);
    expect(await added.json()).toMatchObject({ term: word, flag: 'off_platform_app' }); // stored lower case (term_normalised)
    expect((await op.call('POST', '/staff/chat/detection-terms', { term: word, flag: 'payment_phrase' })).status).toBe(400); // already listed
    const list = (await (await op.call('GET', '/staff/chat/detection-terms')).json()) as { items: { term: string }[] };
    expect(list.items[0].term).toBe(word);

    const { buyer, thread } = await pair();
    expect(await (await buyer.send(thread, `Message me on ${word} please`)).json()).toMatchObject({ flags: ['off_platform_app'] });

    expect((await op.call('DELETE', `/staff/chat/detection-terms?term=${encodeURIComponent(word)}`)).status).toBe(204);
    expect((await op.call('DELETE', `/staff/chat/detection-terms?term=${encodeURIComponent(word)}`)).status).toBe(404);
    expect(await (await buyer.send(thread, `Message me on ${word} again`)).json()).toMatchObject({ flags: [] });
    const audit = await fx.query<{ action: string }>(
      `SELECT action FROM audit.events WHERE actor_id = $1 AND action LIKE 'chat.detection_term.%' ORDER BY id`, [op.staffId]);
    expect(audit.map((a) => a.action)).toEqual(['chat.detection_term.added', 'chat.detection_term.removed']);

    expect((await buyer.call('GET', '/staff/chat/detection-terms')).status).toBe(401);
  });

  it('FR-CHT-04 retention removes the content of threads silent for a year, unless a case holds them', async () => {
    const a = await pair();
    const b = await pair();
    for (const p of [a, b]) {
      await p.buyer.send(p.thread, 'An old question');
      expect((await p.buyer.image(p.thread)).status).toBe(200);
    }
    await fx.query(`UPDATE chat.threads SET last_message_at = now() - interval '13 months' WHERE id = ANY($1)`, [[a.thread, b.thread]]);
    const caseId = randomUUID();
    await commands.hold(b.thread, 'report', caseId);

    expect(await t.app.get(HoldService).purgeDue()).toBeGreaterThanOrEqual(1);
    const content = async (thread: string) =>
      fx.query<{ body: string | null; image_key: string | null; purged: boolean }>(
        `SELECT body, image_key, purged_at IS NOT NULL AS purged FROM chat.messages WHERE thread_id = $1 ORDER BY seq`, [thread]);
    expect(await content(a.thread)).toEqual([{ body: null, image_key: null, purged: true }, { body: null, image_key: null, purged: true }]);
    expect((await content(b.thread)).map((m) => m.purged)).toEqual([false, false]); // held
    const page = (await (await a.buyer.call('GET', `/threads/${a.thread}/messages`)).json()) as { closed: boolean; items: { removed: boolean }[] };
    expect(page.closed).toBe(true);
    expect(page.items.every((m) => m.removed)).toBe(true);
    expect((await a.buyer.send(a.thread, 'Still there?')).status).toBe(409); // thread-closed

    await commands.release(b.thread, 'report', caseId);
    await t.app.get(HoldService).purgeDue();
    expect((await content(b.thread)).map((m) => m.purged)).toEqual([true, true]);
  });
});
