// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router-dom';
import { createDocument, DocumentRoot } from '../../shared/document';
import { fakeBackend, json, noContent, problem, type Call } from '../../testing/app';
import type { StaffMe } from '../model';
import { staffRoutes, staffSignIn } from '../routes';
import { parse } from './ConfigPage';

// The console's administration (IF-UI-09; FR-OPS-03, FR-OPS-04, FR-OPS-08, FR-OPS-09; SEC-IRM-04; SEC-LOG-01,
// SEC-LOG-02; FR-LST-11, FR-CHT-07; U8-10): parameters with every broken rule at once, emergency switches by proposal,
// staff accounts, reference data, the audit log read-only, and the operators' terms.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const staff = (role: StaffMe['role']): StaffMe => ({ id: 's-9', email: 'ad@tb.test', displayName: 'Farhana', role, session: { idleExpiresAt: iso(15 * 60_000), absoluteExpiresAt: iso(8 * HOUR) } });
type Answer = (c: Call) => Response | Promise<Response>;
function backend(role: StaffMe['role'], answers: Record<string, Answer | Answer[]> = {}) {
  return fakeBackend({ 'GET /staff/me': json(200, staff(role)), 'POST /staff/auth/refresh': json(401, {}), ...answers });
}
function open(at: string, be: ReturnType<typeof fakeBackend>) {
  const doc = createDocument(
    { kind: 'staff', titleKey: 'shell.document.staff', home: { path: '/staff', sameDocument: true }, signIn: staffSignIn, routes: staffRoutes },
    { createRouter: (r) => createMemoryRouter(r, { initialEntries: [at] }), apiOverrides: { fetch: be.fetch, cookies: () => '__Host-tb_scsrf=s', locks: undefined, store: undefined } },
  );
  render(<DocumentRoot doc={doc} lang="en" />);
  return doc;
}
async function confirm(region: HTMLElement, reason: string, button: string) {
  fireEvent.change(within(region).getByLabelText(/^Reason/), { target: { value: reason } });
  fireEvent.click(within(region).getByRole('button', { name: button }));
  fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: button }));
}
/** A parameter's fieldset, by the name in its legend. */
const param = (name: string) => screen.getByText((_, el) => el?.tagName === 'LEGEND' && (el.textContent ?? '').includes(name)).closest('fieldset') as HTMLElement;
const form = (title: string | RegExp) => screen.getByRole('heading', { name: title }).closest('form') as HTMLElement;
const values = {
  'CP-13': '15 minutes', 'CP-14': 2, 'CP-07': ['1 hour', '2 hours'], 'CP-25': { pro_bps: 300, standard_bps: 500 },
  'CP-30': ['kyc.revoke', 'staff.mfa_reset'], 'CP-36': true, 'SW-new_orders': true, 'SW-payouts': true,
};

describe('parameters and switches', () => {
  it('FR-OPS-03 FR-OPS-09 a change is checked for every broken rule at once, then published with a reason as a new version', async () => {
    const be = backend('administrator', {
      'GET /admin/config': json(200, { version: 7, values }),
      'GET /admin/config/versions': json(200, [{ version: 7, createdBy: 's-1', reason: 'Shorter checkout hold for the launch.', approvalId: null, createdAt: iso(-HOUR) }]),
      'POST /admin/config/validate': (c) => json(200, { violations: (c.body as { changes: Record<string, unknown> }).changes['CP-13'] === '90 minutes' ? ['CP-13 must be 5-60 minutes', 'CP-19 must exceed CP-18'] : [] })(),
      'POST /admin/config': json(201, { version: 8 }),
    });
    open('/admin/config', be);
    expect(await screen.findByText('Shorter checkout hold for the launch.')).toBeTruthy();
    const hold = param('Fixed-price checkout hold');
    fireEvent.change(within(hold).getByLabelText('Value'), { target: { value: '90 minutes' } });
    expect(screen.getByText('Changed: CP-13')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check every rule' }));
    const alert = await screen.findByText('These rules are broken:');
    expect(within(alert.parentElement!).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['CP-13 must be 5-60 minutes', 'CP-19 must exceed CP-18']);

    const distance = param('Self-pickup distance threshold (km)');
    fireEvent.change(within(distance).getByLabelText('Value'), { target: { value: 'two' } });
    expect(within(distance).getByText('Enter a whole number.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Check every rule' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(distance).getByLabelText('Value'), { target: { value: '2' } });

    fireEvent.change(within(hold).getByLabelText('Value'), { target: { value: '20 minutes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check every rule' }));
    expect(await screen.findByText('No rule is broken.')).toBeTruthy();
    await confirm(form('Publish the changes'), 'A longer hold for slower mobile payments.', 'Publish');
    expect(await screen.findByText('Version 8 is in force.')).toBeTruthy();
    expect(be.called('POST /admin/config')[0].body).toEqual({ changes: { 'CP-13': '20 minutes' }, reason: 'A longer hold for slower mobile payments.' });
    expect(parse('1, 2 ,3', [1])).toEqual({ ok: true, value: [1, 2, 3] });
    expect(parse('', null)).toEqual({ ok: true, value: null });
  });

  it('SEC-IRM-04 CP-30 and the emergency switches change only by proposal for a second administrator', async () => {
    const be = backend('administrator', {
      'GET /admin/config': json(200, { version: 7, values }),
      'GET /admin/config/versions': json(200, []),
      'POST /admin/config/proposals': json(202, { id: 'a-1' }),
    });
    open('/admin/config', be);
    const payouts = (await screen.findByRole('heading', { name: 'Payouts: on' })).closest('form') as HTMLElement;
    await confirm(payouts, 'The payment provider reports a breach; stop payouts.', 'Propose turning it off');
    expect(await within(payouts).findByText('Proposed. A second operator must approve it.')).toBeTruthy();
    expect(be.called('POST /admin/config/proposals')[0].body).toEqual({ changes: { 'SW-payouts': false }, reason: 'The payment provider reports a breach; stop payouts.' });
    expect(screen.queryByText('New orders', { selector: 'legend *' })).toBeNull(); // switches are not in the editor

    const four = param('Actions requiring four-eyes approval');
    fireEvent.change(within(four).getByLabelText(/^Value/), { target: { value: 'kyc.revoke, staff.mfa_reset, account.reinstate' } });
    await confirm(form('Propose the changes'), 'Lifting a suspension needs a second operator too.', 'Propose');
    await waitFor(() => expect(be.called('POST /admin/config/proposals')).toHaveLength(2));
    expect(be.called('POST /admin/config/proposals')[1].body).toEqual({ changes: { 'CP-30': ['kyc.revoke', 'staff.mfa_reset', 'account.reinstate'] }, reason: 'Lifting a suspension needs a second operator too.' });
    expect(be.called('POST /admin/config')).toEqual([]);
  });
});

describe('staff accounts', () => {
  it('FR-OPS-04 a new account\'s first password is shown once; an account is disabled with a reason', async () => {
    const accounts = [{ id: 's-2', email: 'op@tb.test', displayName: 'Nadia', role: 'operator', status: 'active', createdAt: iso(-24 * HOUR) }];
    const be = backend('administrator', {
      'GET /staff/staff': () => json(200, accounts)(),
      'POST /staff/staff': (c) => json(201, { staff: { id: 's-3', status: 'enrolment_required', createdAt: iso(0), ...(c.body as object) }, initialPassword: 'tq-plum-rain-41' })(),
      'POST /staff/staff/s-2/disable': () => { accounts[0] = { ...accounts[0], status: 'disabled' }; return json(200, accounts[0])(); },
    });
    open('/admin/staff', be);
    const add = (await screen.findByRole('heading', { name: 'Add a staff account' })).closest('form') as HTMLElement;
    fireEvent.click(within(add).getByRole('button', { name: 'Create the account' }));
    expect(within(add).getByText(/^Give an e-mail address/)).toBeTruthy();
    fireEvent.change(within(add).getByLabelText('Work e-mail'), { target: { value: ' new@tb.test ' } });
    fireEvent.change(within(add).getByLabelText('Name shown to colleagues'), { target: { value: 'Imran' } });
    fireEvent.click(within(add).getByLabelText('Operator'));
    fireEvent.click(within(add).getByRole('button', { name: 'Create the account' }));
    expect(await within(add).findByText('tq-plum-rain-41')).toBeTruthy();
    expect(within(add).getByText(/^This is shown only now\./)).toBeTruthy();
    expect(be.called('POST /staff/staff')[0].body).toEqual({ email: 'new@tb.test', displayName: 'Imran', role: 'operator' });

    fireEvent.click(screen.getByRole('button', { name: 'Manage Nadia' }));
    await confirm(form('Disable Nadia'), 'Left the company on 20 November.', 'Disable the account');
    expect(await screen.findByText('The account is disabled.')).toBeTruthy();
    expect(be.called('POST /staff/staff/s-2/disable')[0].body).toEqual({ reason: 'Left the company on 20 November.' });
  });
});

describe('the audit log', () => {
  it('SEC-LOG-01 SEC-LOG-02 read-only: filtered, paged by chain position, and the chain checked on the server', async () => {
    const entry = (n: number) => ({ id: `e-${n}`, chainPos: String(n), at: iso(-n * 60_000), actorType: 'staff', actorId: 's-1', action: 'staff.config.published', objectType: 'config_version', objectId: null, before: null, after: { version: n }, reason: 'Change', approvalId: null, sourceIp: null, correlationId: null });
    const be = backend('administrator', {
      'GET /staff/audit': (c) => json(200, c.query.get('before') ? [entry(1)] : Array.from({ length: 50 }, (_, i) => entry(100 - i)))(),
      'GET /staff/audit/verify': [json(200, { intact: true, entries: 151 }), json(200, { intact: false, firstBadId: 'e-77', entries: 151 })],
    });
    open('/admin/audit', be);
    expect(await screen.findAllByText('staff.config.published')).toHaveLength(50);
    expect(screen.queryByRole('button', { name: /delete|edit/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show older entries' }));
    await waitFor(() => expect(screen.getAllByText('staff.config.published')).toHaveLength(51));
    expect(be.called('GET /staff/audit').find((c) => c.query.get('before'))?.query.get('before')).toBe('51');

    fireEvent.change(screen.getByLabelText('Actor ID'), { target: { value: 'not-an-id' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText(/^An ID is a UUID/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Actor ID'), { target: { value: '0b6f2a1c-1111-4a5b-8c9d-0000000000aa' } });
    fireEvent.change(screen.getByLabelText('From (Dhaka date)'), { target: { value: '2026-11-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(be.called('GET /staff/audit').at(-1)!.query.get('actorId')).toBe('0b6f2a1c-1111-4a5b-8c9d-0000000000aa'));
    expect(be.called('GET /staff/audit').at(-1)!.query.get('from')).toBe('2026-11-19T18:00:00.000Z');

    fireEvent.click(screen.getByRole('button', { name: 'Check the chain' }));
    expect(await screen.findByText('The log is intact (151 entries).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check the chain' }));
    expect(await screen.findByText(/^The chain is broken at entry e-77\./)).toBeTruthy();
  });
});

describe('reference data', () => {
  it('FR-OPS-08 CP-43 a fare table is published in taka for all three zones; a meetup point needs coordinates inside Bangladesh', async () => {
    const be = backend('administrator', {
      'GET /games': json(200, { items: [] }),
      'GET /delivery/areas': json(200, { items: [{ id: 1, district: 'Dhaka', nameEn: 'Mirpur', nameBn: 'মিরপুর', zone: 'inside_dhaka', lat: 23.8, lng: 90.36, active: true }] }),
      'GET /admin/meetup-points': json(200, { items: [] }),
      'GET /admin/fare-tables/current': json(200, { version: 2, effectiveFrom: iso(-24 * HOUR), source: 'Rate card, October', rows: [
        { zone: 'inside_dhaka', upTo1kg: '6000', upTo2kg: '8000', perExtraKg: '1500' },
        { zone: 'dhaka_suburbs', upTo1kg: '8000', upTo2kg: '10000', perExtraKg: '2000' },
        { zone: 'outside_dhaka', upTo1kg: '11000', upTo2kg: '13000', perExtraKg: '2500' },
      ] }),
      'POST /admin/fare-tables': json(201, { version: 3, effectiveFrom: iso(0), source: 'x', rows: [] }),
      'POST /admin/meetup-points': json(201, { id: 'mp-1' }),
    });
    open('/admin/reference', be);
    expect(await screen.findByText(/^Version 2 in force since/)).toBeTruthy();
    const fares = form('Publish a new fare table');
    const inside = within(fares).getByText('Inside Dhaka').closest('fieldset') as HTMLElement;
    expect((within(inside).getByLabelText('Up to 1 kg (taka)') as HTMLInputElement).value).toBe('60');
    fireEvent.change(within(inside).getByLabelText('Up to 1 kg (taka)'), { target: { value: '৭০' } });
    fireEvent.click(within(fares).getByRole('button', { name: 'Publish the table' }));
    expect(within(fares).getByText(/^Give every fare in taka/)).toBeTruthy(); // no source yet
    fireEvent.change(within(fares).getByLabelText('Source of the rates'), { target: { value: 'Steadfast rate card, November' } });
    fireEvent.click(within(fares).getByRole('button', { name: 'Publish the table' }));
    expect(await within(fares).findByText('Version 3 is published.')).toBeTruthy();
    expect(be.called('POST /admin/fare-tables')[0].body).toEqual({ source: 'Steadfast rate card, November', rows: [
      { zone: 'inside_dhaka', upTo1kg: '7000', upTo2kg: '8000', perExtraKg: '1500' },
      { zone: 'dhaka_suburbs', upTo1kg: '8000', upTo2kg: '10000', perExtraKg: '2000' },
      { zone: 'outside_dhaka', upTo1kg: '11000', upTo2kg: '13000', perExtraKg: '2500' },
    ] });

    const point = form('Add a meetup point');
    fireEvent.click(within(point).getByLabelText('Police station'));
    for (const [label, v] of [['Name in English', 'Mirpur Model Thana'], ['Name in Bangla', 'মিরপুর মডেল থানা'], ['District', 'Dhaka'], ['Latitude', '51.5'], ['Longitude', '90.36']]) {
      fireEvent.change(within(point).getByLabelText(label), { target: { value: v } });
    }
    fireEvent.click(within(point).getByRole('button', { name: 'Add' }));
    expect(within(point).getByText(/coordinates inside Bangladesh/)).toBeTruthy();
    fireEvent.change(within(point).getByLabelText('Latitude'), { target: { value: '23.8069' } });
    fireEvent.click(within(point).getByRole('button', { name: 'Add' }));
    expect(await within(point).findByText('Added.')).toBeTruthy();
    expect(be.called('POST /admin/meetup-points')[0].body).toEqual({ kind: 'police_station', nameEn: 'Mirpur Model Thana', nameBn: 'মিরপুর মডেল থানা', district: 'Dhaka', lat: 23.8069, lng: 90.36 });
  });
});

describe('by role', () => {
  it('FR-OPS-04 an administrator sees the administration; an operator sees the eight queues and terms, and adds and removes terms', async () => {
    open('/staff/approvals', backend('administrator', { 'GET /staff/approvals': json(200, []) }));
    const adminNav = await screen.findByRole('navigation', { name: 'Console' });
    expect(within(adminNav).getAllByRole('link').map((a) => a.textContent)).toEqual(['Approvals', 'Parameters', 'Staff', 'Reference data', 'Audit log']);
    cleanup();

    const be = backend('operator', {
      'GET /staff/approvals': json(200, []),
      'GET /staff/screening-terms': json(200, { items: [] }),
      'POST /staff/screening-terms': json(201, { id: 4 }),
      'GET /staff/chat/detection-terms': json(200, { items: [{ term: 'bkash me', flag: 'payment_phrase', addedAt: iso(-HOUR) }] }),
      'DELETE /staff/chat/detection-terms': noContent(),
      'GET /admin/config': problem(403, 'forbidden'),
    });
    open('/staff/terms', be);
    const nav = await screen.findByRole('navigation', { name: 'Console' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Disputes', 'Reports', 'Flagged activity', 'KYC submissions', 'Listings in review', 'Ownership proofs', 'Bank payout-account checks', 'Payment discrepancies',
      'Approvals', 'Terms',
    ]);
    const add = form('Add a screening term');
    fireEvent.change(within(add).getByLabelText('Term'), { target: { value: ' replica ' } });
    fireEvent.click(within(add).getByLabelText('High risk: held for review'));
    fireEvent.click(within(add).getByRole('button', { name: 'Add' }));
    expect(await within(add).findByText('Added.')).toBeTruthy();
    expect(be.called('POST /staff/screening-terms')[0].body).toEqual({ term: 'replica', severity: 'high_risk' });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove "bkash me"' }));
    await waitFor(() => expect(be.called('DELETE /staff/chat/detection-terms')).toHaveLength(1));
    expect(be.called('DELETE /staff/chat/detection-terms')[0].query.get('term')).toBe('bkash me');
  });
});
