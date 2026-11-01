import { randomInt, randomUUID } from 'crypto';
import { io, Socket } from 'socket.io-client';
import { loadConfig } from '../../src/kernel/config/config';
import { startApp, TestApp } from '../support/app';
import { openAuction } from '../support/auctions';
import { IdentityFixtures } from '../support/identity';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const sharp = require('sharp') as typeof import('sharp').default;

// U6-02: threads, messages, images, marks, the live messages, the recipient's notice and blocks, against PostgreSQL
// and Redis (docs/design/06_chat_notifications.pdf sections 3.1, 3.2, 6 and 7.4).

interface Msg { seq: number; fromMe: boolean; kind: string; text: string | null; caption: string | null; image: { url: string; expiresAt: string } | null; flags: string[] }

describe('chat', () => {
  let t: TestApp;
  let fx: IdentityFixtures;
  let origin: string;
  let category: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await startApp();
    fx = await IdentityFixtures.open();
    origin = loadConfig(process.env).publicOrigin;
    [{ id: category }] = await fx.query<{ id: number }>(
      `INSERT INTO listings.categories (slug, name_en, name_bn, item_kind) VALUES ($1, 'Phones', 'ফোন', 'physical') RETURNING id`,
      [`chat-${randomUUID().slice(0, 8)}`],
    );
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
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
    const json = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown, status = 200) => {
      const r = await call(method, path, body);
      expect(r.status).toBe(status);
      return (await r.json()) as T;
    };
    const send = (thread: string, text: string, clientId: string = randomUUID()) => call('POST', `/threads/${thread}/messages`, { clientId, text });
    const image = async (thread: string, bytes: Buffer, caption?: string, clientId: string = randomUUID()) => {
      const form = new FormData();
      form.set('clientId', clientId);
      if (caption) form.set('caption', caption);
      form.set('image', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'i.jpg');
      return fetch(t.url(`/threads/${thread}/images`), { method: 'POST', headers, body: form });
    };
    const messages = (thread: string, after = 0) => json<{ items: Msg[]; more: boolean; lastSeq: number; otherMarks: { delivered: number; read: number } }>('GET', `/threads/${thread}/messages?after=${after}`);
    const connect = async () => {
      const s = io(new URL(t.url('/')).origin, { path: '/socket.io', transports: ['websocket'], extraHeaders: { cookie: fx.headers(sid, userId, 'user').cookie, origin }, reconnection: false, forceNew: true });
      sockets.push(s);
      await new Promise<void>((resolve) => s.once('connect', () => resolve()));
      return s;
    };
    return { userId, call, json, send, image, messages, connect };
  }

  /** An active fixed-price listing (two photos, published). */
  async function listing(sellerId: string, status: 'active' | 'draft' = 'active') {
    const [{ id }] = await fx.query<{ id: string }>(
      `INSERT INTO listings.listings (seller_id, item_kind, sale_format, category_id, title, description, condition, no_visible_defects,
          fulfilment_options, weight_class, size_class, area_district, approx_lat, approx_lng, price, quantity_total, quantity_available)
       VALUES ($1, 'physical', 'fixed_price', $2, 'Phone for the chat tests', 'A phone in good condition, written by the chat tests.', 'used', true,
          'pickup_or_courier', 'up_to_1kg', 'small', 'Dhaka', 23.81, 90.41, 1500000, 1, 1) RETURNING id`,
      [sellerId, category],
    );
    for (const n of [1, 2]) {
      await fx.query(`INSERT INTO listings.listing_photos (listing_id, position, storage_key, width, height) VALUES ($1, $2, $3, 800, 600)`, [id, n, randomUUID().replace(/-/g, '')]);
    }
    if (status === 'active') await fx.query(`UPDATE listings.listings SET status = 'active', published_at = now() WHERE id = $1`, [id]);
    return id;
  }
  async function pair() {
    const [seller, buyer] = [await member(), await member()];
    const listingId = await listing(seller.userId);
    const { id } = await buyer.json<{ id: string }>('POST', `/listings/${listingId}/threads`);
    return { seller, buyer, listingId, thread: id };
  }
  const next = <T>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve));

  it('FR-CHT-01 a buyer opens one thread per listing; the seller cannot open one on their own listing; a draft has none', async () => {
    const { seller, buyer, listingId, thread } = await pair();
    expect(await buyer.json('POST', `/listings/${listingId}/threads`)).toEqual({ id: thread }); // found, not a second one
    expect((await seller.call('POST', `/listings/${listingId}/threads`)).status).toBe(403);
    const draft = await listing(seller.userId, 'draft');
    expect((await buyer.call('POST', `/listings/${draft}/threads`)).status).toBe(404);
    expect((await buyer.call('POST', `/listings/${randomUUID()}/threads`)).status).toBe(404);

    await buyer.send(thread, 'Is it still available?');
    const list = await seller.json<{ items: { id: string; role: string; unread: number; other: { displayName: string; verified: boolean }; listing: { title: string } }[] }>('GET', '/threads');
    const mine = list.items.find((i) => i.id === thread)!;
    expect(mine).toMatchObject({ role: 'seller', unread: 1, listing: { title: 'Phone for the chat tests' } });
    expect(Object.keys(mine.other).sort()).toEqual(['displayName', 'verified']); // FR-ACC-10: no id, phone or e-mail
  });

  it('FR-CHT-02 messages get the next sequence number; a resend with the same client id is the same message; others get not-found', async () => {
    const { seller, buyer, thread } = await pair();
    const clientId = randomUUID();
    const first = await (await buyer.send(thread, 'Hello', clientId)).json();
    const again = await (await buyer.send(thread, 'Hello', clientId)).json();
    expect(first).toMatchObject({ seq: 1, duplicate: false });
    expect(again).toMatchObject({ seq: 1, duplicate: true });
    expect(await (await seller.send(thread, 'Hi, yes')).json()).toMatchObject({ seq: 2 });

    const page = await buyer.messages(thread);
    expect(page.items.map((m) => [m.seq, m.fromMe, m.text])).toEqual([[1, true, 'Hello'], [2, false, 'Hi, yes']]);
    expect((await buyer.messages(thread, 1)).items.map((m) => m.seq)).toEqual([2]); // the resync after a gap

    const stranger = await member();
    expect((await stranger.call('GET', `/threads/${thread}/messages`)).status).toBe(404);
    expect((await stranger.send(thread, 'Me too')).status).toBe(404);
    expect((await buyer.send(thread, 'x'.repeat(2001))).status).toBe(400); // DV-40
    expect((await buyer.send(thread, '   ')).status).toBe(400);
  });

  it('FR-CHT-07 a message with a payment phrase is kept with its flag, and the event for review is written', async () => {
    const { buyer, thread } = await pair();
    expect(await (await buyer.send(thread, 'Please send money first')).json()).toMatchObject({ flags: ['payment_phrase'] });
    const [e] = await fx.query<{ payload: { flags: string[] } }>(`SELECT payload FROM chat.outbox WHERE event_type = 'chat.message.flagged' AND aggregate_id = $1`, [thread]);
    expect(e.payload.flags).toEqual(['payment_phrase']);
  });

  it('FR-CHT-03 an image is re-encoded without metadata and shown to participants through a signed link', async () => {
    const { seller, buyer, thread } = await pair();
    const withGps = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7a7' } })
      .jpeg().withMetadata({ exif: { IFD0: { Copyright: 'chat test' } } }).toBuffer();
    const r = await buyer.image(thread, withGps, 'The box');
    expect(r.status).toBe(200);
    const [m] = (await seller.messages(thread)).items;
    expect(m).toMatchObject({ kind: 'image', caption: 'The box', fromMe: false });
    const got = await seller.call('GET', m.image!.url.replace(/^\/api\/v1/, '')); // the link belongs to the viewer's session (CP-31)
    expect(got.status).toBe(200);
    expect((await sharp(Buffer.from(await got.arrayBuffer())).metadata()).exif).toBeUndefined();
    const [{ image_key }] = await fx.query<{ image_key: string }>(`SELECT image_key FROM chat.messages WHERE thread_id = $1`, [thread]);
    expect(image_key.length).toBeGreaterThan(80); // Unit 1's key, kept whole (Decisions log, U6-02)

    expect((await buyer.image(thread, Buffer.from('not an image'))).status).toBeGreaterThanOrEqual(400);
  });

  it('FR-CHT-05 chat.message reaches both participants live; chat.ack moves the marks and tells the sender', async () => {
    const { seller, buyer, thread } = await pair();
    const [bs, ss] = [await buyer.connect(), await seller.connect()];
    const [toBuyer, toSeller] = [next<Record<string, unknown>>(bs, 'chat.message'), next<Record<string, unknown>>(ss, 'chat.message')];
    await buyer.send(thread, 'Can we meet at noon?');
    expect(await toBuyer).toMatchObject({ threadId: thread, seq: 1, fromMe: true, text: 'Can we meet at noon?' });
    expect(await toSeller).toMatchObject({ threadId: thread, seq: 1, fromMe: false, text: 'Can we meet at noon?' });

    const marks = next<Record<string, unknown>>(bs, 'chat.marks');
    expect(await ss.emitWithAck('chat.ack', { threadId: thread, delivered: 1, read: 1 })).toEqual({ ok: true });
    expect(await marks).toEqual({ threadId: thread, delivered: 1, read: 1 });
    expect((await buyer.messages(thread)).otherMarks).toEqual({ delivered: 1, read: 1 });
    // marks only move forward, and never past the last message
    expect((await seller.call('POST', `/threads/${thread}/marks`, { delivered: 0, read: 0 })).status).toBe(204);
    expect((await buyer.messages(thread)).otherMarks).toEqual({ delivered: 1, read: 1 });

    const outsider = await (await member()).connect();
    expect(await outsider.emitWithAck('chat.ack', { threadId: thread, delivered: 1, read: 1 })).toEqual({ ok: false, error: 'not-found' });
  });

  it('DV-41 the recipient gets an in-app notice for each message, without its text; e-mail only when away and once per window', async () => {
    const { seller, buyer, thread } = await pair();
    await buyer.send(thread, 'First question about the phone');
    await buyer.send(thread, 'Second question about the phone');
    const notices = await fx.query<{ id: string; params: Record<string, string>; subject_type: string; email: string | null }>(
      `SELECT n.id, n.params, n.subject_type, d.status AS email FROM notify.notifications n
         LEFT JOIN notify.deliveries d ON d.notification_id = n.id AND d.channel = 'email'
        WHERE n.user_id = $1 AND n.template_code = 'chat.message_received' ORDER BY n.created_at`, [seller.userId]);
    expect(notices).toHaveLength(2);
    expect(notices[0].params).toEqual({ listing_title: 'Phone for the chat tests', sender_name: expect.any(String) });
    expect(JSON.stringify(notices)).not.toContain('question');
    expect(notices.map((n) => n.subject_type)).toEqual(['thread', 'thread']);
    expect(notices.map((n) => n.email)).toEqual(['pending', 'suppressed']); // coalesced within the window

    // connected: no e-mail at all
    const { seller: s2, buyer: b2, thread: t2 } = await pair();
    await s2.connect();
    await b2.send(t2, 'Are you there?');
    const [n] = await fx.query<{ email: string }>(
      `SELECT d.status AS email FROM notify.notifications n JOIN notify.deliveries d ON d.notification_id = n.id AND d.channel = 'email'
        WHERE n.user_id = $1 AND n.template_code = 'chat.message_received'`, [s2.userId]);
    expect(n.email).toBe('suppressed');
    expect(t2).toBeDefined();
  });

  it('FR-CHT-08 a block stops messages both ways, new threads, purchases and bids; unblocking restores them', async () => {
    const { seller, buyer, listingId, thread } = await pair();
    expect((await seller.call('POST', `/blocks/${buyer.userId}`)).status).toBe(204);
    expect((await seller.call('POST', `/blocks/${buyer.userId}`)).status).toBe(204); // idempotent
    for (const [who, text] of [[buyer, 'hello?'], [seller, 'no']] as const) {
      const r = await who.send(thread, text);
      expect(r.status).toBe(403);
      expect((await r.json()).type).toMatch(/blocked$/);
    }
    const other = await listing(seller.userId);
    expect((await buyer.call('POST', `/listings/${other}/threads`)).status).toBe(403);
    // I-37: the blocked user cannot buy
    const order = await buyer.call('POST', '/orders', { listingId, quantity: 1 });
    expect(order.status).toBe(403);
    expect((await order.json()).type).toMatch(/blocked$/);
    // I-38: nor bid on the blocker's auction
    const auction = await openAuction(fx, seller.userId, category);
    const bid = await buyer.call('POST', `/auctions/${auction}/bids`, { maximum: '150000' });
    expect(bid.status).toBe(403);

    expect((await seller.call('POST', `/blocks/${seller.userId}`)).status).toBe(400);
    expect((await seller.call('DELETE', `/blocks/${buyer.userId}`)).status).toBe(204);
    expect((await buyer.send(thread, 'hello again')).status).toBe(200);
  });
});
