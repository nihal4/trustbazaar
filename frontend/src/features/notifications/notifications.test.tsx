// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { placeholders } from '../../lib/i18n.js';
import { fakeBackend, json, renderApp, standInMe, type Call } from '../../testing/app';
import { UNREAD_POLL_MS, type NotificationView } from '../../shared/notifications';
import { subjectPath } from './NotificationsPage';
import en from '../../messages/en/notifications.json';
import bn from '../../messages/bn/notifications.json';

// The notification centre and preferences (FR-NTF-04, FR-NTF-05; Unit 6 section 3.1) and the language
// kept in the preferences (NFR-USE-04; section 6.1).

configure({ asyncUtilTimeout: 3000 });
afterEach(cleanup);

const notice = (n: Partial<NotificationView> & { id: string }): NotificationView => ({
  code: 'order_paid', title: 'Payment received', body: 'Order TB-1001 is paid.', subject: { type: 'order', id: 'o-1' },
  createdAt: '2026-11-01T12:00:00Z', readAt: null, ...n,
});

function backend(o: { prefs?: { language: 'bn' | 'en'; emailTransactional: boolean }; signedIn?: boolean; pages?: unknown[] } = {}) {
  const state = { prefs: o.prefs ?? { language: 'en' as const, emailTransactional: true }, readAll: false };
  const first = { items: [notice({ id: 'n-1' }), notice({ id: 'n-2', title: 'New sign-in', body: '<b>Chrome</b> on Android', subject: { type: 'account', id: 'u-1' }, readAt: '2026-11-01T10:00:00Z' })], unread: 1, nextCursor: 'c-2' };
  const second = { items: [notice({ id: 'n-3', title: 'Listing published', subject: { type: 'listing', id: 'l-9' }, readAt: '2026-10-30T10:00:00Z' })], unread: 1, nextCursor: null };
  const be = fakeBackend({
    'GET /me': o.signedIn === false ? json(401, { type: '/problems/session-ended' }) : json(200, standInMe),
    'POST /auth/refresh': json(401, {}),
    'GET /notifications': (c: Call) => {
      const page = c.query.get('cursor') === 'c-2' ? second : first;
      return json(200, state.readAll ? { ...page, unread: 0, items: page.items.map((i) => ({ ...i, readAt: i.readAt ?? '2026-11-01T13:00:00Z' })) } : page)();
    },
    'POST /notifications/read': (c: Call) => { if ((c.body as { all?: boolean }).all) state.readAll = true; return json(200, { unread: 0 })(); },
    'GET /me/notification-preferences': () => json(200, state.prefs)(),
    'PUT /me/notification-preferences': (c: Call) => { state.prefs = { ...state.prefs, ...(c.body as object) }; return json(200, state.prefs)(); },
  });
  return { be, state };
}

describe('the notification centre', () => {
  it('FR-NTF-04 notices are listed newest first with their time in Dhaka, the unread ones marked in words, the text as plain text', async () => {
    const { be } = backend();
    renderApp('/notifications', be);
    expect(await screen.findByText('1 unread')).toBeTruthy();
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => within(li).getByText(/Payment received|New sign-in/).textContent)).toEqual(['Payment received', 'New sign-in']);
    expect(within(items[0]).getByText('New')).toBeTruthy();
    expect(within(items[1]).queryByText('New')).toBeNull();
    expect(within(items[0]).getByText('Sun 1 Nov 2026, 6:00 pm')).toBeTruthy();
    expect(within(items[1]).getByText('<b>Chrome</b> on Android')).toBeTruthy();
    expect(items[1].querySelector('b')).toBeNull();
  });

  it('FR-NTF-04 opening a notice marks it read and goes to what it concerns', async () => {
    const { be } = backend();
    const doc = renderApp('/notifications', be);
    fireEvent.click(await screen.findByRole('button', { name: /Payment received/ }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/orders/o-1'));
    expect(be.called('POST /notifications/read')[0].body).toEqual({ ids: ['n-1'] });
  });

  it('FR-NTF-04 a read notice is not marked again when opened', async () => {
    const { be } = backend();
    const doc = renderApp('/notifications', be);
    fireEvent.click(await screen.findByRole('button', { name: /New sign-in/ }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/account/security'));
    expect(be.called('POST /notifications/read')).toEqual([]);
  });

  it('FR-NTF-04 everything can be marked read at once, and older notices load page by page', async () => {
    const { be } = backend();
    renderApp('/notifications', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Show older notifications' }));
    expect(await screen.findByText('Listing published')).toBeTruthy();
    expect(be.called('GET /notifications').map((c) => c.query.get('cursor'))).toContain('c-2');
    expect(screen.queryByRole('button', { name: 'Show older notifications' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByText('Everything is read.')).toBeTruthy();
    expect(be.called('POST /notifications/read')[0].body).toEqual({ all: true });
  });

  it('FR-NTF-04 the header shows the unread count, in words for screen readers, and re-reads it every 60 seconds', async () => {
    const { be } = backend();
    const doc = renderApp('/account', be);
    const link = await screen.findByRole('link', { name: 'Notifications, 1 unread' });
    expect(link.getAttribute('href')).toBe('/notifications');
    expect(UNREAD_POLL_MS).toBe(60_000);
    const q = doc.queryClient.getQueryCache().find({ queryKey: ['notifications', 'first'] });
    expect((q?.options as { refetchInterval?: number }).refetchInterval).toBe(60_000);
  });

  it('FR-NTF-04 without a session the centre offers sign-in and asks nothing about notices', async () => {
    const { be } = backend({ signedIn: false });
    renderApp('/notifications', be);
    expect(await screen.findByText('Sign in to see your notifications.')).toBeTruthy();
    expect(be.called('GET /notifications')).toEqual([]);
    expect(be.called('GET /me/notification-preferences')).toEqual([]);
  });

  it.each([
    [{ type: 'order', id: 'o 1' }, '/orders/o%201'], [{ type: 'listing', id: 'l-9' }, '/listings/l-9'],
    [{ type: 'payout', id: 'p-1' }, '/account/payout'], [{ type: 'account', id: 'u-1' }, '/account/security'],
    [{ type: 'refund', id: 'r-1' }, null], [null, null],
  ] as const)('FR-NTF-04 a notice about %j leads to %s', (subject, path) => {
    expect(subjectPath(subject as never)).toBe(path);
  });
});

describe('preferences', () => {
  it('FR-NTF-05 transactional e-mails can be turned off; security notices are said to be always sent', async () => {
    const { be } = backend();
    renderApp('/notifications', be);
    const box = await screen.findByLabelText('Send me e-mails about my orders and payments');
    expect(screen.getByText(/Security notices, such as a sign-in from a new device, are always sent/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save settings' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Your settings are saved.')).toBeTruthy();
    expect(be.called('PUT /me/notification-preferences').map((c) => c.body)).toContainEqual({ emailTransactional: false });
  });

  it('NFR-USE-04 after sign-in the page language is saved to the account when it differs, and every switch is saved', async () => {
    const { be, state } = backend({ prefs: { language: 'bn', emailTransactional: true } });
    renderApp('/account', be, 'en');
    await waitFor(() => expect(be.called('PUT /me/notification-preferences').map((c) => c.body)).toEqual([{ language: 'en' }]));
    expect(state.prefs.language).toBe('en');

    fireEvent.click(screen.getByRole('button', { name: 'Change the language to Bangla' }));
    await waitFor(() => expect(be.called('PUT /me/notification-preferences').map((c) => c.body)).toEqual([{ language: 'en' }, { language: 'bn' }]));
  });

  it('NFR-USE-04 nothing is saved when the languages already agree, or for a guest', async () => {
    const { be } = backend({ prefs: { language: 'en', emailTransactional: true } });
    renderApp('/account', be, 'en');
    await screen.findByRole('heading', { name: 'Your account' });
    await waitFor(() => expect(be.called('GET /me/notification-preferences')).toHaveLength(1));
    expect(be.called('PUT /me/notification-preferences')).toEqual([]);
    cleanup();
    const guest = backend({ signedIn: false });
    renderApp('/signin', guest.be, 'en');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(guest.be.called('GET /me/notification-preferences')).toEqual([]);
    expect(guest.be.called('PUT /me/notification-preferences')).toEqual([]);
  });

  it('NFR-USE-04 choosing the language in the settings switches the page and saves it', async () => {
    const { be } = backend({ prefs: { language: 'en', emailTransactional: true } });
    renderApp('/notifications', be, 'en');
    fireEvent.click(await screen.findByLabelText('বাংলা'));
    expect(await screen.findByRole('heading', { level: 1, name: 'নোটিফিকেশন' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('bn');
    await waitFor(() => expect(be.called('PUT /me/notification-preferences').map((c) => c.body)).toContainEqual({ language: 'bn' }));
  });
});

describe('the notification catalogues', () => {
  const E: Record<string, string> = en;
  const B: Record<string, string> = bn;
  it('NFR-USE-04 both languages have the same keys and placeholders, Bangla in Bangla script', () => {
    expect(Object.keys(B).sort()).toEqual(Object.keys(E).sort());
    for (const k of Object.keys(E)) {
      expect(placeholders(B[k]), k).toEqual(placeholders(E[k]));
      expect(B[k], k).toMatch(/[ঀ-৿]/);
    }
  });

  it('SEC-INP-03 no message contains markup', () => {
    for (const [k, v] of [...Object.entries(E), ...Object.entries(B)]) expect(v, k).not.toMatch(/[<>]|&\w+;/);
  });
});
