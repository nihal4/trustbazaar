// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router-dom';
import { placeholders } from '../lib/i18n.js';
import { createDocument, DocumentRoot } from '../shared/document';
import { fakeBackend, json, noContent, problem, type Call } from '../testing/app';
import type { Approval, QueueItem, StaffMe } from './model';
import { staffRoutes, staffSignIn } from './routes';
import { safeNext } from './SignInPage';
import en from '../messages/en/staff.json';
import bn from '../messages/bn/staff.json';

// The staff console, first part (IF-UI-09; FR-OPS-01, FR-OPS-05, FR-OPS-06; SEC-AUTH-07, SEC-SES-06; U8-10): the staff
// sign-in with the authenticator (and the first enrolment), the session's CP-03 limits, the eight queues with ages and
// claims, and the four-eyes approvals.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const operator = (o: Partial<StaffMe> = {}): StaffMe => ({
  id: 's-1', email: 'op@tb.test', displayName: 'Nadia', role: 'operator',
  session: { idleExpiresAt: iso(15 * 60_000), absoluteExpiresAt: iso(8 * HOUR) }, ...o,
});
type Answer = (c: Call) => Response | Promise<Response>;
function backend(answers: Record<string, Answer | Answer[]> = {}) {
  return fakeBackend({ 'POST /staff/auth/refresh': json(401, {}), ...answers });
}
function open(at: string, be: ReturnType<typeof fakeBackend>, lang: 'en' | 'bn' = 'en') {
  const doc = createDocument(
    { kind: 'staff', titleKey: 'shell.document.staff', home: { path: '/staff', sameDocument: true }, signIn: staffSignIn, routes: staffRoutes },
    { createRouter: (r) => createMemoryRouter(r, { initialEntries: [at] }), apiOverrides: { fetch: be.fetch, cookies: () => '__Host-tb_scsrf=s-csrf', locks: undefined, store: undefined } },
  );
  render(<DocumentRoot doc={doc} lang={lang} />);
  return doc;
}
const item = (o: Partial<QueueItem> = {}): QueueItem => ({ id: 'd0000001-aaaa-4bbb-8ccc-000000000001', ageHours: 30.5, since: iso(-30.5 * HOUR), status: 'open', assignedTo: null, path: '/x', ...o });

describe('signing in', () => {
  it('SEC-AUTH-07 I-51 a first visit goes to the staff sign-in without the signed-out notice; password then authenticator code, then back', async () => {
    let signedIn = false;
    const be = backend({
      'GET /staff/me': () => (signedIn ? json(200, operator()) : json(401, {}))(),
      'POST /staff/auth/signin': [json(401, { type: '/problems/signin-failed' }), json(200, { mfaRequired: true })],
      'POST /staff/auth/mfa': [problem(401, 'otp-failed'), () => { signedIn = true; return noContent()(); }],
      'GET /staff/queues/reports': json(200, { queue: 'reports', items: [] }),
    });
    const doc = open('/staff/queues/reports', be);
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/staff/signin'));
    expect(doc.router.state.location.search).toBe(`?next=${encodeURIComponent('/staff/queues/reports')}`);
    expect(screen.queryByText(/signed out/i)).toBeNull();
    fireEvent.change(await screen.findByLabelText('Work e-mail'), { target: { value: 'op@tb.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('The e-mail or password is not right, or this account cannot sign in.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '১২৩ ৪৫৬' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('The code is not right. Use the newest code from your app.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/staff/queues/reports'));
    expect(be.called('POST /staff/auth/signin')[1].body).toEqual({ email: 'op@tb.test', password: 'right one' });
    expect(be.called('POST /staff/auth/mfa')[0].body).toEqual({ code: '123456' });
    expect(be.called('POST /staff/auth/mfa')[0].headers.get('X-CSRF-Token')).toBe('s-csrf');
    expect(await screen.findByText('Nadia')).toBeTruthy();
    expect(safeNext('https://evil.example/staff')).toBe('/staff');
    expect(safeNext('/orders/1')).toBe('/staff');
  });

  it('SEC-AUTH-07 a new account chooses its own password, adds the authenticator from the key, and its first code signs it in', async () => {
    let signedIn = false;
    const be = backend({
      'GET /staff/me': () => (signedIn ? json(200, operator({ role: 'administrator' })) : json(401, {}))(),
      'POST /staff/auth/signin': json(200, { enrolmentRequired: true }),
      'POST /staff/auth/mfa/enrol': [
        problem(422, 'password-rejected', { errors: [{ field: 'newPassword', reason: 'unchanged' }] }),
        json(200, { otpauthUri: 'otpauth://totp/TrustBazaar%20staff:ad%40tb.test?secret=ABCD', secret: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' }),
      ],
      'POST /staff/auth/mfa/enrol/confirm': () => { signedIn = true; return noContent()(); },
      'GET /staff/approvals': json(200, []),
    });
    const doc = open('/staff/signin', be);
    fireEvent.change(await screen.findByLabelText('Work e-mail'), { target: { value: 'ad@tb.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'given-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(await screen.findByLabelText('Your new password'), { target: { value: 'given-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Choose a password other than the one you were given.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your new password'), { target: { value: 'my own console passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open in an authenticator app' }).getAttribute('href')).toMatch(/^otpauth:\/\/totp\//);
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/staff/approvals'));
    expect(screen.queryByRole('link', { name: 'Queues' })).toBeNull(); // an administrator has no operator queues
  });
});

describe('the session', () => {
  it('SEC-SES-06 a minute before the idle end the console warns, and "Stay signed in" refreshes and reads the new end', async () => {
    let end = iso(50_000);
    const be = backend({
      'GET /staff/me': () => json(200, operator({ session: { idleExpiresAt: end, absoluteExpiresAt: iso(8 * HOUR) } }))(),
      'POST /staff/auth/refresh': () => { end = iso(15 * 60_000); return noContent()(); },
      'GET /staff/approvals': json(200, []),
    });
    open('/staff/approvals', be);
    const alert = await screen.findByText(/^You will be signed out in 0:(4|5)\d because nothing has been done/);
    fireEvent.click(within(alert.closest('[role="alert"]')!).getByRole('button', { name: 'Stay signed in' }));
    await waitFor(() => expect(screen.queryByText(/^You will be signed out/)).toBeNull());
    expect(be.called('POST /staff/auth/refresh')).toHaveLength(1);
    expect(be.called('POST /staff/auth/refresh')[0].headers.get('X-CSRF-Token')).toBe('s-csrf');
  });

  it('SEC-SES-06 while the staff member is working, the session is refreshed before its idle end without a warning', async () => {
    let end = iso(100_000);
    const be = backend({
      'GET /staff/me': () => json(200, operator({ session: { idleExpiresAt: end, absoluteExpiresAt: iso(8 * HOUR) } }))(),
      'POST /staff/auth/refresh': () => { end = iso(15 * 60_000); return noContent()(); },
      'GET /staff/approvals': json(200, []),
    });
    open('/staff/approvals', be);
    expect(await screen.findByText('Nothing is waiting for your approval.')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document.body, { key: 'Tab' }); });
    await waitFor(() => expect(be.called('POST /staff/auth/refresh')).toHaveLength(1));
    expect(screen.queryByText(/^You will be signed out/)).toBeNull();
  });
});

describe('the queues', () => {
  it('FR-OPS-01 the eight queues; each item with its age, the overdue on top, what it is, and who has it', async () => {
    const be = backend({
      'GET /staff/me': json(200, operator()),
      'GET /staff/queues/disputes': json(200, { queue: 'disputes', items: [
        item({ overdue: true, ageHours: 75.2, type: 'not_as_described', amountCollected: '2500000', decisionTargetAt: iso(-HOUR), fourEyes: true }),
        item({ id: 'd0000002-aaaa-4bbb-8ccc-000000000002', ageHours: 3.4, type: 'not_received', amountCollected: '150000', assignedTo: 's-1' }),
      ] }),
      'GET /staff/queues/payment_discrepancies': problem(409, 'feature-off', { errors: [{ field: 'queue', reason: 'payment-discrepancies-not-yet-available' }] }),
    });
    const doc = open('/staff', be);
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/staff/queues/disputes'));
    const nav = screen.getByRole('navigation', { name: 'Console' });
    await waitFor(() => expect(within(nav).getByRole('link', { name: /^Disputes/ }).textContent).toBe('Disputes2 waiting'));
    expect(within(nav).getAllByRole('link').map((a) => a.textContent?.replace(/\d+ waiting$/, ''))).toEqual([
      'Disputes', 'Reports', 'Flagged activity', 'KYC submissions', 'Listings in review', 'Ownership proofs', 'Bank payout-account checks', 'Payment discrepancies',
      'Approvals', 'Terms',
    ]);
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Case', 'What it is', 'Amount', 'Waiting', 'Who has it', 'Action']);
    expect(rows).toHaveLength(2);
    const cells = (r: HTMLElement) => [within(r).getByRole('rowheader'), ...within(r).getAllByRole('cell')].map((c) => c.textContent);
    expect(cells(rows[0]).slice(0, 5)).toEqual(['Ref. d0000001', expect.stringContaining("needs a second operator's approval"), '৳25,000', expect.stringMatching(/^Overdue · 3 d 3 h oldwaiting since /), 'not claimed']);
    expect(within(rows[0]).getByText(/^Overdue · 3 d 3 h old/).className).toMatch(/late/);   // a day or more: red, in words too
    expect(cells(rows[1])[3]).toMatch(/^3 h old/);
    expect(within(rows[1]).getByText(/^3 h old/).className).not.toMatch(/late/);
    expect(cells(rows[1])[4]).toBe('claimed by you');
    expect(within(rows[1]).queryByRole('button')).toBeNull();
    fireEvent.click(within(nav).getByRole('link', { name: 'Payment discrepancies' }));
    expect(await screen.findByText('This queue is not available yet.')).toBeTruthy();
  });

  it('FR-OPS-06 a claim runs the conflict check; a refusal is said in words, a claim makes the case the operator\'s', async () => {
    const reports = [item({ id: 'r0000001-aaaa-4bbb-8ccc-000000000001', targetType: 'listing', category: 'fraud', ageHours: 2 })];
    let claimed = false;
    const be = backend({
      'GET /staff/me': json(200, operator()),
      'GET /staff/queues/reports': () => json(200, { queue: 'reports', items: reports.map((r) => ({ ...r, assignedTo: claimed ? 's-1' : null })) })(),
      'POST /staff/cases/report/r0000001-aaaa-4bbb-8ccc-000000000001/claim': [
        problem(403, 'conflict-of-interest'),
        () => { claimed = true; return json(200, { id: 'r0000001-aaaa-4bbb-8ccc-000000000001' })(); },
      ],
    });
    open('/staff/queues/reports', be);
    fireEvent.click(await screen.findByRole('button', { name: 'Claim r0000001' }));
    expect(await screen.findByText(/^You cannot take this case: you have a conflict of interest/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Claim r0000001' }));
    expect(await screen.findByText('Claimed. The case is yours.')).toBeTruthy();
    expect(await screen.findByText(/claimed by you/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Claim r0000001' })).toBeNull();
  });
});

describe('approvals', () => {
  it('FR-OPS-05 a proposal shows what it does, why and until when; approving is confirmed first and sends the note', async () => {
    const a: Approval = {
      id: 'a-1', action: 'kyc.revoke', targetType: 'user', targetId: 'u0000001-aaaa-4bbb-8ccc-000000000001', payload: {}, reason: 'Document found to be forged.',
      requiredRole: 'operator', proposedBy: 's-2', proposedAt: iso(-HOUR), expiresAt: iso(23 * HOUR),
    };
    let open1 = true;
    const be = backend({
      'GET /staff/me': json(200, operator()),
      'GET /staff/approvals': () => json(200, open1 ? [a] : [])(),
      'POST /staff/approvals/a-1/decision': () => { open1 = false; return json(200, { ...a, decision: 'approved' })(); },
    });
    open('/staff/approvals', be);
    const card = (await screen.findByRole('heading', { name: 'Revoke a verification' })).closest('li')!;
    expect(within(card).getByText('Document found to be forged.')).toBeTruthy();
    expect(within(card).getByText('user u0000001')).toBeTruthy();
    fireEvent.change(within(card).getByLabelText('Note (optional)'), { target: { value: ' Checked the original. ' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve: Revoke a verification?' });
    expect(within(dialog).getByText(/^The action runs now/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Nothing is waiting for your approval.')).toBeTruthy();
    expect(be.called('POST /staff/approvals/a-1/decision')[0].body).toEqual({ decision: 'approved', note: 'Checked the original.' });
  });

  it('NFR-USE-04 the console in Bangla; both languages have the same keys and placeholders', async () => {
    open('/staff/approvals', backend({ 'GET /staff/me': json(200, operator()), 'GET /staff/approvals': json(200, []) }), 'bn');
    expect(await screen.findByText('আপনার অনুমোদনের জন্য কিছু অপেক্ষায় নেই।')).toBeTruthy();
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(bn[k])).toEqual(placeholders(en[k]));
  });
});
