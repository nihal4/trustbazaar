// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, screen, waitFor } from '@testing-library/react';
import { FakeSocket, fakeBackend, json, renderApp, standInMe } from '../testing/app';
import { Live } from './live';

// The live connection (section 5; IF-COM-01, IF-COM-02, I-65): one per tab after sign-in, rooms re-joined and
// state fetched again after every reconnection, an expired token renewed, an ended session not retried.

configure({ asyncUtilTimeout: 3000 });
afterEach(cleanup);

function live(renew = vi.fn(async () => undefined)) {
  const socket = new FakeSocket();
  const l = new Live(() => {
    socket.opened++;
    return socket;
  }, renew);
  return { l, socket, renew };
}

describe('the live connection', () => {
  it('IF-COM-02 rooms are joined when connected and again after every reconnection, and screens are told', () => {
    const { l, socket } = live();
    const leave = l.join('auction:a-1');
    const connected = vi.fn();
    l.onConnect(connected);
    l.start();
    expect(socket.emitted).toEqual([]);
    socket.accept();
    expect(socket.emitted).toEqual([{ event: 'join', payload: { room: 'auction:a-1' } }]);
    socket.drop();
    socket.accept();
    expect(socket.emitted.filter((e) => e.event === 'join')).toHaveLength(2);
    expect(connected).toHaveBeenCalledTimes(2);
    leave();
    expect(socket.emitted.at(-1)).toEqual({ event: 'leave', payload: { room: 'auction:a-1' } });
  });

  it('IF-COM-01 a room is left only when the last screen using it leaves', () => {
    const { l, socket } = live();
    l.start();
    socket.accept();
    const a = l.join('auction:a-1');
    const b = l.join('auction:a-1');
    expect(socket.emitted.filter((e) => e.event === 'join')).toHaveLength(1);
    a();
    expect(socket.rooms()).toEqual(['auction:a-1']);
    b();
    expect(socket.rooms()).toEqual([]);
  });

  it('IF-COM-01 messages reach the screens listening, also those that began listening before the connection', () => {
    const { l, socket } = live();
    const seen: unknown[] = [];
    const off = l.on('auction.state', (p) => seen.push(p));
    l.start();
    socket.accept();
    socket.push('auction.state', { seq: 1 });
    off();
    socket.push('auction.state', { seq: 2 });
    expect(seen).toEqual([{ seq: 1 }]);
  });

  it('SEC-SES-07 an expired token is renewed through the API, then the connection is opened again', async () => {
    const { l, socket, renew } = live();
    l.start();
    socket.refuse('token-expired');
    await waitFor(() => expect(socket.connects).toBe(1));
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('SEC-SES-07 a connection refused because the session ended is closed, not retried', () => {
    const { l, socket } = live();
    l.start();
    socket.refuse('session-ended');
    expect(socket.disconnects).toBe(1);
    expect(socket.connects).toBe(0);
    expect(l.connected).toBe(false);
  });

  it('I-65 the client may load after the first paint; a connection loaded after sign-out is closed at once', async () => {
    const socket = new FakeSocket();
    let loaded: (s: FakeSocket) => void = () => undefined;
    const l = new Live(() => new Promise((r) => { loaded = r; }), async () => undefined);
    l.start();
    l.start();
    l.stop();
    loaded(socket);
    await Promise.resolve();
    expect(socket.disconnects).toBe(1);
    expect(l.connected).toBe(false);
    const again = new FakeSocket();
    const l2 = new Live(() => Promise.resolve(again), async () => undefined);
    l2.start();
    await waitFor(() => { again.accept(); expect(l2.connected).toBe(true); });
  });

  it('I-65 the user app opens one connection after sign-in, and none for a guest', async () => {
    const signedIn = new FakeSocket();
    renderApp('/notifications', fakeBackend({
      'GET /me': json(200, standInMe), 'GET /notifications': json(200, { items: [], unread: 0, nextCursor: null }),
      'GET /notifications/unread-count': json(200, { unread: 0 }), 'GET /me/notification-preferences': json(200, { language: 'en', emailTransactional: true }),
    }), 'en', signedIn);
    await screen.findByRole('heading', { name: 'Notifications' });
    await waitFor(() => expect(signedIn.opened).toBe(1));
    cleanup();
    const guest = new FakeSocket();
    renderApp('/', fakeBackend({ 'GET /me': json(401, { type: '/problems/session-ended' }), 'POST /auth/refresh': json(401, {}) }), 'en', guest);
    await screen.findByRole('heading', { name: 'Home' });
    await new Promise((r) => setTimeout(r, 50));
    expect(guest.opened).toBe(0);
  });
});
