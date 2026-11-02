// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { FakeSocket, fakeBackend, json, noContent, problem, renderApp, standInMe, type Call } from '../../testing/app';
import type { ServerMessage, ThreadSummary } from './model';
import en from '../../messages/en/chat.json';
import bn from '../../messages/bn/chat.json';

// The chat screens (IF-UI-07; sections 5 and 7.6; FR-CHT-01 to FR-CHT-09; IF-COM-02): the thread list, messages as
// text with the warnings, sending with a client id and "Sending…", resync after gaps and reconnections, marks,
// photos, block and report, and the ways in from a listing and an order.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());

const THREAD = '5b1c2a3e-2222-4a5b-8c9d-000000000001';
const LISTING = '7d1c2a3e-1111-4a5b-8c9d-000000000001';
const OTHER = '6f1c2b1e-0000-4000-8000-000000000002';
const AT = '2026-11-02T06:00:00.000Z';

const summary = (o: Partial<ThreadSummary> = {}): ThreadSummary => ({
  id: THREAD, listing: { id: LISTING, title: 'Desk lamp' }, role: 'buyer',
  other: { id: OTHER, displayName: 'Karim', verified: true }, lastSeq: 2, unread: 1, lastMessageAt: AT, closed: false, ...o,
});
const msg = (seq: number, o: Partial<ServerMessage> = {}): ServerMessage => ({
  clientId: null, seq, fromMe: false, kind: 'text', text: `Message ${seq}`, caption: null, image: null, flags: [], at: AT, removed: false, ...o,
});

/** A server holding the thread's messages; GET ?after= answers from it, POST adds to it. */
function server(o: { messages?: ServerMessage[]; thread?: ThreadSummary; post?: (c: Call) => Response | Promise<Response>; closed?: boolean } = {}) {
  const messages = [...(o.messages ?? [msg(1), msg(2)])];
  const marks = { delivered: 0, read: 0 };
  const be = fakeBackend({
    'GET /me': json(200, standInMe),
    'GET /threads': json(200, { items: [o.thread ?? summary()], nextCursor: null }),
    [`GET /threads/${THREAD}/messages`]: (c) => {
      const after = Number(c.query.get('after') ?? 0);
      const items = messages.filter((m) => m.seq > after).sort((a, b) => a.seq - b.seq);
      return json(200, { items, more: false, lastSeq: messages.length, otherMarks: marks, closed: o.closed ?? false })();
    },
    [`POST /threads/${THREAD}/messages`]: o.post ?? ((c) => {
      const body = c.body as { clientId: string; text: string };
      const seq = messages.length + 1;
      messages.push(msg(seq, { clientId: body.clientId, fromMe: true, text: body.text }));
      return json(200, { seq, flags: [], duplicate: false })();
    }),
    [`POST /threads/${THREAD}/marks`]: noContent(),
    [`POST /blocks/${OTHER}`]: noContent(),
    [`DELETE /blocks/${OTHER}`]: noContent(),
    [`POST /threads/${THREAD}/reports`]: problem(409, 'feature-off', { errors: [{ field: 'report', reason: 'reports-not-yet-available' }] }),
  });
  return { be, messages, marks };
}

async function openThread(s = server(), socket = new FakeSocket()) {
  renderApp(`/messages/${THREAD}`, s.be, 'en', socket);
  await screen.findByRole('log', { name: 'Messages' });
  await waitFor(() => expect(socket.opened).toBe(1));
  act(() => socket.accept());
  return { ...s, socket };
}
const log = () => screen.getByRole('log', { name: 'Messages' });
const texts = () => within(log()).queryAllByRole('listitem').map((li) => li.querySelector('p')?.textContent);

describe('the thread list', () => {
  it('IF-UI-07 conversations show the other party by name and badge, the listing and the unread count in words', async () => {
    renderApp('/messages', server().be);
    const link = await screen.findByRole('link', { name: /Karim/ });
    expect(link.getAttribute('href')).toBe(`/messages/${THREAD}`);
    expect(within(link).getByText('Verified')).toBeTruthy();
    expect(within(link).getByText('About: Desk lamp')).toBeTruthy();
    expect(within(link).getByText('1 unread')).toBeTruthy();
    expect(within(link).getByText(/You are the buyer/)).toBeTruthy();
  });

  it('IF-UI-07 an empty list says how to start, and a signed-out visitor is asked to sign in', async () => {
    renderApp('/messages', fakeBackend({ 'GET /me': json(200, standInMe), 'GET /threads': json(200, { items: [], nextCursor: null }) }));
    expect(await screen.findByText(/No conversations yet/)).toBeTruthy();
    cleanup();
    renderApp('/messages', fakeBackend({ 'GET /me': problem(401, 'session-ended') }));
    expect(await screen.findByText('Sign in to see your messages.')).toBeTruthy();
  });
});

describe('a conversation', () => {
  it('SEC-INP-03 FR-CHT-09 messages are plain text; a web address stays text, with a warning', async () => {
    await openThread(server({ messages: [msg(1, { text: '<b>hello</b> <img src=x onerror=alert(1)>' }), msg(2, { text: 'See www.example.com/deal' })] }));
    expect(await within(log()).findByText('<b>hello</b> <img src=x onerror=alert(1)>')).toBeTruthy();
    expect(log().querySelector('b, img')).toBeNull();
    expect(log().querySelector('a')).toBeNull(); // the address is not a link
    expect(within(log()).getAllByText(/Web addresses are not opened from chat/)).toHaveLength(1);
  });

  it('FR-CHT-07 a flagged message shows its warning to both parties; login details point the seller to the sealed handover', async () => {
    const flagged = [msg(1, { text: 'Pay first by bKash', flags: ['payment_phrase'] }), msg(2, { text: 'my password is ...', flags: ['credentials'], fromMe: true })];
    await openThread(server({ messages: flagged }));
    expect(await within(log()).findByText(/asks for payment outside TrustBazaar/)).toBeTruthy();
    expect(within(log()).getByText(/may contain login details/).textContent).not.toMatch(/sealed handover/); // the buyer
    cleanup();
    await openThread(server({ messages: flagged, thread: summary({ role: 'seller' }) }));
    expect(await within(log()).findByText(/sealed handover on the order/)).toBeTruthy();
  });

  it('FR-CHT-02 a message shows "Sending…" and is confirmed once by its client id when the server\'s copy arrives', async () => {
    let answer!: (r: Response) => void;
    const s = server({ post: () => new Promise<Response>((r) => { answer = r; }) });
    const { socket, be } = await openThread(s);
    await within(log()).findByText('Message 2');
    fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Is it still available?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Sending…')).toBeTruthy();
    expect((screen.getByLabelText('Your message') as HTMLTextAreaElement).value).toBe('');
    const sent = be.called(`POST /threads/${THREAD}/messages`)[0].body as { clientId: string; text: string };
    expect(sent.text).toBe('Is it still available?');
    expect(sent.clientId).toMatch(/^[0-9a-f-]{36}$/);
    act(() => socket.push('chat.message', { ...msg(3, { clientId: sent.clientId, fromMe: true, text: 'Is it still available?' }), threadId: THREAD, image: false }));
    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
    expect(within(log()).getAllByText('Is it still available?')).toHaveLength(1);
    await act(async () => answer(json(200, { seq: 3, flags: [], duplicate: false })()));
    expect(within(log()).getAllByText('Is it still available?')).toHaveLength(1);
  });

  it('FR-CHT-02 a message that could not be sent is offered again with the same client id; a block explains itself', async () => {
    const s = server({
      post: (() => {
        let n = 0;
        return () => (++n === 1 ? problem(503, 'internal')() : problem(403, 'blocked')());
      })(),
    });
    const { be } = await openThread(s);
    fireEvent.change(await screen.findByLabelText('Your message'), { target: { value: 'Hello?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Not sent.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('You cannot exchange messages with this member.')).toBeTruthy();
    const [a, b] = be.called(`POST /threads/${THREAD}/messages`).map((c) => (c.body as { clientId: string }).clientId);
    expect(a).toBe(b);
  });

  it('IF-COM-02 a gap and a reconnection fetch the missing messages after the last one held, in order', async () => {
    const s = server();
    const { socket, be, messages } = await openThread(s);
    await within(log()).findByText('Message 2');
    messages.push(msg(3), msg(4), msg(5));
    act(() => socket.push('chat.message', { ...msg(5), threadId: THREAD, image: false })); // 3 and 4 were lost
    await within(log()).findByText('Message 5');
    expect(be.called(`GET /threads/${THREAD}/messages`).some((c) => c.query.get('after') === '2')).toBe(true);
    expect(texts()).toEqual(['Message 1', 'Message 2', 'Message 3', 'Message 4', 'Message 5']);

    messages.push(msg(6));
    act(() => socket.drop());
    act(() => socket.accept());
    await within(log()).findByText('Message 6');
    expect(be.called(`GET /threads/${THREAD}/messages`).some((c) => c.query.get('after') === '5')).toBe(true);
    act(() => socket.push('chat.message', { ...msg(4), threadId: THREAD, image: false })); // a duplicate: ignored
    act(() => socket.push('chat.message', { ...msg(7), threadId: 'another-thread', image: false }));
    expect(texts()).toHaveLength(6);
  });

  it('FR-CHT-05 shown messages are acknowledged (over the connection when open, else over HTTP); the other side\'s marks show under my last message', async () => {
    const s = server({ messages: [msg(1), msg(2, { fromMe: true, clientId: 'c-2', text: 'Mine' })] });
    const { socket, be } = await openThread(s);
    await within(log()).findByText('Mine');
    // loaded before the connection opened: acknowledged over HTTP
    await waitFor(() => expect(be.called(`POST /threads/${THREAD}/marks`).at(-1)?.body).toEqual({ delivered: 2, read: 2 }));
    act(() => socket.push('chat.message', { ...msg(3), threadId: THREAD, image: false }));
    await waitFor(() => expect(socket.emitted.filter((e) => e.event === 'chat.ack').at(-1)?.payload).toEqual({ threadId: THREAD, delivered: 3, read: 3 }));
    act(() => socket.push('chat.marks', { threadId: THREAD, delivered: 2, read: 0 }));
    expect(await within(log()).findByText(/· Delivered/)).toBeTruthy();
    act(() => socket.push('chat.marks', { threadId: THREAD, delivered: 2, read: 2 }));
    expect(await within(log()).findByText(/· Read/)).toBeTruthy();
  });

  it('FR-CHT-03 a photo is sent with its caption and shown through its link, with its size limited', async () => {
    const photos: Call[] = [];
    const withPhoto = fakeBackend({
      'GET /me': json(200, standInMe),
      'GET /threads': json(200, { items: [summary()], nextCursor: null }),
      [`GET /threads/${THREAD}/messages`]: (c) => json(200, {
        items: [msg(1), ...(photos.length ? [msg(2, { fromMe: true, clientId: 'x', kind: 'image', text: null, caption: 'The box', image: { url: '/api/v1/files/v/tok', expiresAt: AT } })] : [])]
          .filter((m) => m.seq > Number(c.query.get('after') ?? 0)),
        more: false, lastSeq: photos.length ? 2 : 1, otherMarks: { delivered: 0, read: 0 }, closed: false,
      })(),
      [`POST /threads/${THREAD}/images`]: (c) => { photos.push(c); return json(200, { seq: 2, flags: [], duplicate: false })(); },
    });
    await openThread({ be: withPhoto, messages: [], marks: { delivered: 0, read: 0 } });
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'box.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Add a photo'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Caption (optional)'), { target: { value: 'The box' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send photo' }));
    const img = await within(log()).findByRole('img', { name: 'The box' });
    expect(img.getAttribute('src')).toBe('/api/v1/files/v/tok');
    const form = photos[0].body as FormData;
    expect(form.get('caption')).toBe('The box');
    expect(form.get('clientId')).toMatch(/^[0-9a-f-]{36}$/);
    expect(form.get('image')).toBeInstanceOf(File);
  });

  it('FR-CHT-08 blocking states its consequence first, then blocks by the other party\'s id; unblocking is offered', async () => {
    const { be } = await openThread();
    fireEvent.click(await screen.findByRole('button', { name: 'Block Karim' }));
    const dialog = await screen.findByRole('dialog', { name: 'Block Karim?' });
    expect(within(dialog).getByText(/will not be able to buy from you or bid on your listings/)).toBeTruthy();
    expect(be.called(`POST /blocks/${OTHER}`)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Block Karim' }));
    expect(await screen.findByText('You blocked Karim. You can unblock them here.')).toBeTruthy();
    expect(be.called(`POST /blocks/${OTHER}`)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Unblock Karim' }));
    expect(await screen.findByText('You unblocked Karim.')).toBeTruthy();
  });

  it('FR-CHT-06 a message or the thread is reported with a category; until reporting opens, the page says so', async () => {
    const { be } = await openThread();
    await within(log()).findByText('Message 2');
    fireEvent.click(within(log()).getAllByRole('button', { name: 'Report message' })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Choose what is wrong.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Fraud or a scam'));
    fireEvent.change(screen.getByLabelText('Anything else we should know (optional)'), { target: { value: ' Asked to pay outside. ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Reporting is not available yet. Please try again later.')).toBeTruthy();
    expect(be.called(`POST /threads/${THREAD}/reports`)[0].body).toEqual({ category: 'fraudulent', messageSeq: 2, text: 'Asked to pay outside.' });
    expect(screen.getByRole('button', { name: 'Report this conversation' })).toBeTruthy();
  });

  it('FR-CHT-04 a closed conversation can be read but not answered; removed messages say why', async () => {
    await openThread(server({ messages: [msg(1, { text: null, removed: true })], closed: true }));
    expect(await within(log()).findByText('This message was removed after the retention period.')).toBeTruthy();
    expect(screen.getByText(/closed after a year without messages/)).toBeTruthy();
    expect(screen.queryByLabelText('Your message')).toBeNull();
  });

  it('IF-UI-07 an unknown conversation says so', async () => {
    renderApp(`/messages/${THREAD}`, fakeBackend({
      'GET /me': json(200, standInMe), 'GET /threads': json(200, { items: [], nextCursor: null }),
      [`GET /threads/${THREAD}/messages`]: problem(404, 'not-found'),
    }));
    expect(await screen.findByRole('heading', { name: 'This conversation could not be found.' })).toBeTruthy();
  });

  it('DV-40 a message over 2,000 characters is not sent; the count is shown', async () => {
    const { be } = await openThread();
    fireEvent.change(await screen.findByLabelText('Your message'), { target: { value: 'x'.repeat(2001) } });
    expect(screen.getByText('A message can have at most 2000 characters.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    expect(be.called(`POST /threads/${THREAD}/messages`)).toHaveLength(0);
  });
});

describe('ways in', () => {
  it('FR-CHT-01 "Message the seller" on a listing opens or finds the thread and goes to it', async () => {
    const listing = {
      id: LISTING, itemKind: 'physical', saleFormat: 'fixed_price', status: 'active', category: { id: 1, slug: 'lamps', nameEn: 'Lamps', nameBn: 'বাতি' },
      title: 'Desk lamp', description: 'A lamp.', condition: 'used', noVisibleDefects: true, fulfilmentOptions: 'pickup_only', district: 'Dhaka',
      price: '150000', quantity: { total: 1, available: 1 }, currentlyReserved: false, photos: [], clarifications: [], auction: null,
      seller: { id: OTHER, displayName: 'Karim', verified: true, joinMonth: '2026-01' },
    };
    const be = fakeBackend({
      'GET /me': json(200, standInMe),
      [`GET /listings/${LISTING}`]: json(200, listing),
      [`POST /listings/${LISTING}/threads`]: json(200, { id: THREAD }),
      'GET /threads': json(200, { items: [summary()], nextCursor: null }),
      [`GET /threads/${THREAD}/messages`]: json(200, { items: [], more: false, lastSeq: 0, otherMarks: { delivered: 0, read: 0 }, closed: false }),
    });
    renderApp(`/listings/${LISTING}`, be);
    fireEvent.click(await screen.findByRole('button', { name: 'Message the seller' }));
    expect(await screen.findByRole('heading', { name: /Conversation with Karim/ })).toBeTruthy();
    expect(screen.getByText(/No messages yet/)).toBeTruthy();
  });

  it('FR-NTF-04 a chat notice opens its conversation', async () => {
    const be = fakeBackend({
      'GET /me': json(200, standInMe),
      'GET /notifications': json(200, { items: [{ id: 'n-1', code: 'chat.message_received', title: 'New message', body: 'You have a new message from Karim about Desk lamp.', subject: { type: 'thread', id: THREAD }, readAt: AT, createdAt: AT }], unread: 0, nextCursor: null }),
      'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
      'GET /threads': json(200, { items: [summary()], nextCursor: null }),
      [`GET /threads/${THREAD}/messages`]: json(200, { items: [msg(1)], more: false, lastSeq: 1, otherMarks: { delivered: 0, read: 0 }, closed: false }),
    });
    renderApp('/notifications', be);
    fireEvent.click(await screen.findByRole('button', { name: /New message/ }));
    expect(await screen.findByRole('heading', { name: /Conversation with Karim/ })).toBeTruthy();
  });

  it('NFR-USE-04 both languages have the same keys and placeholders, in Bangla script', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
    for (const v of Object.values(bn)) expect(v).toMatch(/[ঀ-৿]/);
  });
});
