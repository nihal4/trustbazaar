// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router-dom';
import { createDocument, DocumentRoot } from '../../shared/document';
import { fakeBackend, json, noContent, problem, type Call } from '../../testing/app';
import type { StaffMe } from '../model';
import { staffRoutes, staffSignIn } from '../routes';

// The console's case files and their actions (IF-UI-09; FR-OPS-02; FR-DSP-05, FR-DSP-06, FR-DSP-09; SEC-ACC-05,
// SEC-ACC-06; FR-KYC-06; FR-LST-11, FR-LST-12; FR-GAM-04; FR-PAY-21; FR-TNS-01; U8-10): each action with a required
// reason, its consequence confirmed first, and the server's answer in words.

configure({ asyncUtilTimeout: 3000 });
afterEach(() => cleanup());

const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const ID = 'd0000001-aaaa-4bbb-8ccc-000000000001';
const me: StaffMe = { id: 's-1', email: 'op@tb.test', displayName: 'Nadia', role: 'operator', session: { idleExpiresAt: iso(15 * 60_000), absoluteExpiresAt: iso(8 * HOUR) } };
type Answer = (c: Call) => Response | Promise<Response>;
function backend(answers: Record<string, Answer | Answer[]> = {}) {
  return fakeBackend({ 'GET /staff/me': json(200, me), 'POST /staff/auth/refresh': json(401, {}), ...answers });
}
function open(at: string, be: ReturnType<typeof fakeBackend>) {
  const doc = createDocument(
    { kind: 'staff', titleKey: 'shell.document.staff', home: { path: '/staff', sameDocument: true }, signIn: staffSignIn, routes: staffRoutes },
    { createRouter: (r) => createMemoryRouter(r, { initialEntries: [at] }), apiOverrides: { fetch: be.fetch, cookies: () => '__Host-tb_scsrf=s', locks: undefined, store: undefined } },
  );
  render(<DocumentRoot doc={doc} lang="en" />);
  return doc;
}
/** Fill an action's reason and confirm it. */
async function act(region: HTMLElement, reason: string, button: string) {
  fireEvent.change(within(region).getByLabelText(/^Reason|^The resolution|^The review|^What the seller should send/), { target: { value: reason } });
  fireEvent.click(within(region).getByRole('button', { name: button }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: button }));
}
const form = (title: string) => screen.getByRole('heading', { name: title }).closest('form') as HTMLElement;

const caseFile = (o: { fourEyes?: boolean; amount?: string } = {}) => ({
  dispute: { id: ID, type: 'not_as_described', status: 'under_review', description: 'The phone has a cracked screen not shown in the photos.', openedAt: iso(-48 * HOUR), sellerDueAt: iso(-24 * HOUR), infoDueAt: null, reviewStartedAt: iso(-20 * HOUR), decisionTargetAt: iso(24 * HOUR), fourEyes: o.fourEyes ?? false },
  parties: { buyer: { displayName: 'Rahim', verified: true }, seller: { displayName: 'Karim', verified: false } },
  order: { id: 'o-1', kind: 'fixed_price', status: 'delivered', listing: { id: 'l-1', title: 'Phone X', itemKind: 'physical' }, itemPrice: o.amount ?? '1500000', deliveryFee: '10000', total: '1510000', fulfilment: 'courier', paidAt: iso(-96 * HOUR) },
  escrow: { state: 'frozen_disputed', amountCollected: o.amount ?? '1510000', disputeWindowEndsAt: null, autoReleaseAt: null },
  outcomes: { itemPrice: o.amount ?? '1500000', deliveryFee: '10000', release: { refunded: '0', sellerPayout: '1425000' }, fullRefund: { refunded: '1510000', sellerPayout: '0' }, partialRefund: null },
  fulfilment: null, game: null, chat: { threadId: 't-1', path: `/staff/cases/dispute/${ID}/threads/t-1` },
  history: [{ from: null, to: 'open', actor: 'buyer', reason: null, at: iso(-48 * HOUR) }],
  statements: [{ party: 'seller', text: 'It left my hands without a crack.', at: iso(-30 * HOUR) }],
  evidence: [{ id: 'e-1', party: 'buyer', mime: 'image/jpeg', size: 1000, at: iso(-47 * HOUR), link: { url: '/api/v1/files/v/tok1', expiresAt: iso(300_000) } }],
  context: { disputes: [], strikes: [], sanctions: [] },
});

describe('a dispute', () => {
  it('FR-DSP-05 FR-DSP-06 the case file, then a partial refund decided with Unit 2\'s exact split shown first and a reason', async () => {
    const be = backend({
      'GET /staff/queues/disputes': json(200, { items: [{ id: ID, ageHours: 48, since: iso(-48 * HOUR), status: 'under_review', assignedTo: 's-1', path: '/x', type: 'not_as_described' }] }),
      [`GET /staff/disputes/${ID}/case-file`]: json(200, caseFile()),
      [`GET /staff/disputes/${ID}/outcome-preview`]: (c) => json(200, { ...caseFile().outcomes, partialRefund: { itemRefund: c.query.get('itemRefund'), refunded: '500000', sellerPayout: '950000' } })(),
      [`POST /staff/disputes/${ID}/decision`]: json(200, { status: 'decided' }),
      [`GET /staff/cases/dispute/${ID}/threads/t-1`]: json(200, { threadId: 't-1', closed: false, messages: [{ seq: 1, from: 'buyer', kind: 'text', text: 'Is the screen fine?', caption: null, image: null, flags: [], at: iso(-100 * HOUR), removed: false }] }),
    });
    const doc = open('/staff/queues/disputes', be);
    fireEvent.click(await screen.findByRole('link', { name: 'Open d0000001' }));
    await waitFor(() => expect(doc.router.state.location.pathname).toBe(`/staff/disputes/${ID}`));
    expect(await screen.findByText('The phone has a cracked screen not shown in the photos.')).toBeTruthy();
    expect(screen.getByText('It left my hands without a crack.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the file' }).getAttribute('href')).toBe('/api/v1/files/v/tok1');
    fireEvent.click(screen.getByRole('button', { name: 'Show the chat' }));
    expect(await screen.findByText('Is the screen fine?')).toBeTruthy();

    const decide = form('Decide the dispute');
    fireEvent.click(within(decide).getByLabelText('Release the payment to the seller'));
    expect(within(decide).getByText('The buyer gets back ৳0; the seller is paid ৳14,250.')).toBeTruthy();
    fireEvent.click(within(decide).getByLabelText('Refund part of the item price'));
    fireEvent.change(within(decide).getByLabelText(/^Refund of the item price/), { target: { value: '৫,০০০' } });
    fireEvent.change(within(decide).getByLabelText(/^Reason/), { target: { value: 'The crack is visible in the delivery photo, so half the fault is the seller\'s.' } });
    fireEvent.click(within(decide).getByRole('button', { name: 'Decide' }));
    expect(within(decide).getByText(/^Choose the outcome; for a partial refund, show the split/)).toBeTruthy(); // no split shown yet
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(within(decide).getByRole('button', { name: 'Show the split' }));
    expect(await within(decide).findByText('The buyer gets back ৳5,000; the seller is paid ৳9,500.')).toBeTruthy();
    expect(be.called(`GET /staff/disputes/${ID}/outcome-preview`)[0].query.get('itemRefund')).toBe('500000');
    fireEvent.change(within(decide).getByLabelText(/^Reason/), { target: { value: 'Too short.' } });
    fireEvent.click(within(decide).getByRole('button', { name: 'Decide' }));
    expect(within(decide).getByText('Write a reason of at least 20 characters.')).toBeTruthy();
    await act(decide, 'The crack is visible in the delivery photo, so half the fault is the seller\'s.', 'Decide');
    expect(await screen.findByText('Decided. The money has moved and both members are told.')).toBeTruthy();
    expect(be.called(`POST /staff/disputes/${ID}/decision`)[0].body).toEqual({
      outcome: 'partial_refund', reason: 'The crack is visible in the delivery photo, so half the fault is the seller\'s.', itemRefund: '500000',
    });
  });

  it('FR-TNS-10 a return that is stuck after a mismatch: the check is shown, the decision forms are gone, and the operator closes it with a reason as a rejected return', async () => {
    const f = caseFile();
    const stuck = { ...f, dispute: { ...f.dispute, status: 'awaiting_return' }, returnCheck: { checks: [{ matched: false, at: iso(-HOUR) }], canResolve: true, finding: null, findings: [] } };
    const be = backend({ [`GET /staff/disputes/${ID}/case-file`]: json(200, stuck), [`POST /staff/disputes/${ID}/resolve-return`]: json(200, { status: 'decided' }) });
    open(`/staff/disputes/${ID}`, be);
    expect(await screen.findByText(/did NOT match the listing/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Decide the dispute' })).toBeNull();
    const closing = form('Close the return');
    fireEvent.click(within(closing).getByLabelText('Not the item sold: pay the seller'));
    await act(closing, 'The returned phone has another IMEI than the one sold.', 'Close the return');
    expect(await screen.findByText('The return is closed.')).toBeTruthy();
    expect(be.called(`POST /staff/disputes/${ID}/resolve-return`)[0].body).toEqual({ outcome: 'release', reason: 'The returned phone has another IMEI than the one sold.' });
  });

  it('FR-TNS-10 a finding about the buyer after the dispute is decided: only the kinds the server offers, a reason of 20 characters, and the answer says when buying is suspended', async () => {
    const f = caseFile();
    const decided = { ...f, dispute: { ...f.dispute, status: 'decided' }, returnCheck: { checks: [], canResolve: false, finding: null, findings: ['false_claim'] } };
    const be = backend({ [`GET /staff/disputes/${ID}/case-file`]: json(200, decided), [`POST /staff/disputes/${ID}/buyer-finding`]: json(200, { strike: true, suspended: true }) });
    open(`/staff/disputes/${ID}`, be);
    await screen.findByRole('heading', { name: 'Finding about the buyer' });
    const rec = form('Finding about the buyer');
    expect(within(rec).queryByLabelText(/A swap/)).toBeNull();
    fireEvent.click(within(rec).getByLabelText(/A false claim/));
    await act(rec, 'The buyer broke the item himself; the handover video shows it working.', 'Record the finding');
    expect(await screen.findByText("The finding is recorded and the buyer's buying is suspended.")).toBeTruthy();
    expect(be.called(`POST /staff/disputes/${ID}/buyer-finding`)[0].body).toEqual({ finding: 'false_claim', reason: 'The buyer broke the item himself; the handover video shows it working.' });
  });

  it('FR-DSP-06 CP-30 at BDT 20,000 or more the form says so and the decision becomes a proposal; an unclaimed case says to claim it', async () => {
    const be = backend({
      [`GET /staff/disputes/${ID}/case-file`]: json(200, caseFile({ fourEyes: true, amount: '2500000' })),
      [`POST /staff/disputes/${ID}/decision`]: json(202, { status: 'proposed', approvalId: 'a-1' }),
    });
    open(`/staff/disputes/${ID}`, be);
    const decide = (await screen.findByRole('heading', { name: 'Decide the dispute' })).closest('form') as HTMLElement;
    expect(within(decide).getByText("This decision needs a second operator's approval.")).toBeTruthy();
    fireEvent.click(within(decide).getByLabelText('Refund the buyer in full'));
    await act(decide, 'The item never arrived and the courier confirms it was lost.', 'Decide');
    expect(await screen.findByText('Proposed. A second operator must approve it under Approvals.')).toBeTruthy();
    cleanup();
    open(`/staff/disputes/${ID}`, backend({ [`GET /staff/disputes/${ID}/case-file`]: problem(409, 'not-claimed') }));
    expect(await screen.findByText(/^Claim this case in its queue first/)).toBeTruthy();
  });
});

describe('KYC', () => {
  it('SEC-ACC-06 FR-KYC-06 an image opens only with a reason, by an expiring link; a rejection names its reason and carries the operator\'s', async () => {
    const be = backend({
      [`GET /staff/kyc/submissions/${ID}`]: json(200, { id: ID, userId: 'u-1', docType: 'nid', docNumber: '1990123456789', fullName: 'Rahim Uddin', dateOfBirth: '1990-01-01', isAdult: true, livenessAction: 'turn_left', flags: ['face_low'], submittedAt: iso(-HOUR), files: ['doc_front', 'selfie_neutral'] }),
      [`POST /staff/kyc/submissions/${ID}/files/doc_front/view`]: json(200, { url: '/api/v1/files/v/k1', expiresAt: iso(300_000) }),
      [`POST /staff/kyc/submissions/${ID}/decision`]: json(200, { status: 'rejected' }),
    });
    open(`/staff/kyc/${ID}`, be);
    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    const item = screen.getByText(/^Front of the document/).closest('li') as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: 'Show' }));
    fireEvent.click(within(item).getByRole('button', { name: 'Open with this reason' }));
    expect(within(item).getByText('Write a reason of at least 10 characters.')).toBeTruthy();
    fireEvent.change(within(item).getByLabelText('Why you need to see the Front of the document'), { target: { value: 'Compare the photo with the selfie.' } });
    fireEvent.click(within(item).getByRole('button', { name: 'Open with this reason' }));
    expect((await within(item).findByRole('link', { name: 'Open the file' })).getAttribute('href')).toBe('/api/v1/files/v/k1');
    expect(be.called(`POST /staff/kyc/submissions/${ID}/files/doc_front/view`)[0].body).toEqual({ reason: 'Compare the photo with the selfie.' });

    const decide = form('Decide the submission');
    fireEvent.click(within(decide).getByLabelText('Reject'));
    fireEvent.change(within(decide).getByLabelText(/^Reason/), { target: { value: 'The selfie shows another person.' } });
    fireEvent.click(within(decide).getByRole('button', { name: 'Decide' }));
    expect(within(decide).getByText('Choose approve, or reject with a reason.')).toBeTruthy();
    fireEvent.click(within(decide).getByLabelText('The selfie does not match the document'));
    await act(decide, 'The selfie shows another person.', 'Decide');
    expect(await screen.findByText('Rejected. The member is told.')).toBeTruthy();
    expect(be.called(`POST /staff/kyc/submissions/${ID}/decision`)[0].body).toEqual({ decision: 'reject', reason: 'selfie_mismatch', note: 'The selfie shows another person.' });
  });
});

describe('listings, proofs and payout accounts', () => {
  it('FR-LST-11 FR-LST-12 a held listing is read whole, returned to its seller with a reason, or removed', async () => {
    const be = backend({
      [`GET /staff/listings/${ID}`]: json(200, { id: ID, itemKind: 'physical', saleFormat: 'fixed_price', status: 'pending_review', title: 'Gold watch', description: 'Looks like the famous brand.', condition: 'used_good', category: { nameEn: 'Watches', nameBn: 'ঘড়ি' }, price: '250000', district: 'Dhaka', photos: [{ id: 'p1', url: '/p/1', thumbUrl: '/p/1?size=thumb', showsDefects: false }], seller: { id: 'u-2', displayName: 'Karim', verified: true }, auction: null }),
      [`POST /staff/listings/${ID}/review`]: json(200, { status: 'draft' }),
      [`POST /staff/listings/${ID}/remove`]: json(200, { status: 'removed' }),
    });
    open(`/staff/listings/${ID}`, be);
    expect(await screen.findByText('Looks like the famous brand.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Photo 1' }).getAttribute('src')).toBe('/p/1?size=thumb');
    const review = form('Review the listing');
    fireEvent.click(within(review).getByLabelText('Return to the seller'));
    await act(review, 'Replica watches may not be sold; describe the original.', 'Decide');
    expect(await screen.findByText('Returned to the seller.')).toBeTruthy();
    expect(be.called(`POST /staff/listings/${ID}/review`)[0].body).toEqual({ decision: 'return', reason: 'Replica watches may not be sold; describe the original.' });
    await act(form('Remove for a policy breach'), 'The photos show a counterfeit brand mark.', 'Remove the listing');
    expect(await screen.findByText('The listing is removed.')).toBeTruthy();
  });

  it('FR-GAM-04 an ownership proof: the screenshot by a signed link; a live check that did not match cannot be approved', async () => {
    const be = backend({
      'GET /staff/queues/ownership_proofs': json(200, { items: [{ id: ID, ageHours: 2, since: iso(-2 * HOUR), status: 'submitted', assignedTo: null, path: '/x', listingId: 'l-9', game: 'PUBG Mobile', platform: 'android', playerId: '5123456789', codeExpiresAt: iso(HOUR) }] }),
      [`GET /staff/game/ownership-proofs/${ID}/screenshot`]: json(200, { url: '/api/v1/files/v/s1', expiresAt: iso(300_000) }),
      [`POST /staff/game/ownership-proofs/${ID}/review`]: json(200, { status: 'approved' }),
    });
    open(`/staff/ownership-proofs/${ID}`, be);
    expect(await screen.findByText('5123456789')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show the screenshot' }));
    expect((await screen.findByRole('img', { name: "The seller's screenshot" })).getAttribute('src')).toBe('/api/v1/files/v/s1');
    const review = form('Review the proof');
    fireEvent.click(within(review).getByLabelText('It does not match'));
    fireEvent.click(within(review).getByLabelText('Approve and publish the listing'));
    fireEvent.change(within(review).getByLabelText(/^Reason/), { target: { value: 'Checked the profile in the game.' } });
    fireEvent.click(within(review).getByRole('button', { name: 'Decide' }));
    expect(within(review).getByText('A proof whose live check did not match cannot be approved.')).toBeTruthy();
    fireEvent.click(within(review).getByLabelText('The code shows on that player ID'));
    await act(review, 'Checked the profile in the game.', 'Decide');
    expect(await screen.findByText('Approved. The listing is published.')).toBeTruthy();
    expect(be.called(`POST /staff/game/ownership-proofs/${ID}/review`)[0].body).toEqual({ decision: 'approve', liveCheck: 'matched', reason: 'Checked the profile in the game.' });
  });

  it('FR-PAY-21 a bank account is checked against the verified legal name and rejected with a reason', async () => {
    const be = backend({
      'GET /staff/payout-accounts/pending': json(200, { items: [{ id: ID, userId: 'u-3', kind: 'bank', status: 'pending_review', bankName: 'Sonali Bank', branchName: 'Motijheel', accountName: 'R. Traders', accountLast4: '4321', routingNumber: '200270522', kycLegalName: 'Rahim Uddin', createdAt: iso(-HOUR) }] }),
      [`POST /staff/payout-accounts/${ID}/decision`]: json(200, { account: { id: ID, status: 'rejected' } }),
    });
    open(`/staff/payout-accounts/${ID}`, be);
    expect(await screen.findByText('R. Traders')).toBeTruthy();
    expect(screen.getByText('Rahim Uddin')).toBeTruthy();
    const decide = form('Decide the account');
    fireEvent.click(within(decide).getByLabelText('Reject'));
    await act(decide, 'The account is in a business name, not the member\'s.', 'Decide');
    expect(await screen.findByText('Rejected. The member is told.')).toBeTruthy();
    expect(be.called(`POST /staff/payout-accounts/${ID}/decision`)[0].body).toEqual({ decision: 'reject', reason: 'The account is in a business name, not the member\'s.' });
  });
});

describe('reports and members', () => {
  it('FR-TNS-01 FR-OPS-02 a report shows the reporter\'s words; it is resolved, and its member sanctioned until a date, each with a reason', async () => {
    const be = backend({
      'GET /staff/queues/reports': json(200, { items: [{ id: ID, ageHours: 3, since: iso(-3 * HOUR), status: 'under_review', assignedTo: 's-1', path: '/x', targetType: 'user', targetId: 'u-4', category: 'abusive', subjectUser: 'u0000004-aaaa-4bbb-8ccc-000000000004', text: 'Insulted me in the chat twice.' }] }),
      [`POST /staff/reports/${ID}/resolution`]: json(200, { reportId: ID, status: 'actioned' }),
      'POST /staff/users/u0000004-aaaa-4bbb-8ccc-000000000004/sanctions': json(201, { sanctionId: 'x-1' }),
      'POST /staff/conflicts': noContent(),
    });
    open(`/staff/reports/${ID}`, be);
    expect(await screen.findByText('Insulted me in the chat twice.')).toBeTruthy();
    const resolve = form('Resolve the report');
    fireEvent.click(within(resolve).getByLabelText('Actioned: action taken'));
    await act(resolve, 'Warned the member about the chat rules.', 'Resolve');
    expect(await screen.findByText('The report is resolved.')).toBeTruthy();
    expect(be.called(`POST /staff/reports/${ID}/resolution`)[0].body).toEqual({ outcome: 'actioned', resolution: 'Warned the member about the chat rules.' });

    const sanction = form('Apply a sanction');
    fireEvent.click(within(sanction).getByLabelText('Suspend selling'));
    fireEvent.change(within(sanction).getByLabelText(/^Until/), { target: { value: '2099-01-31' } });
    await act(sanction, 'Repeated abuse of other members.', 'Apply the sanction');
    expect(await screen.findByText('The sanction is applied.')).toBeTruthy();
    expect(be.called('POST /staff/users/u0000004-aaaa-4bbb-8ccc-000000000004/sanctions')[0].body).toEqual({
      kind: 'selling_suspended', reason: 'Repeated abuse of other members.', endsAt: '2099-01-31T17:59:59.000Z', related: { type: 'report', id: ID },
    });
    await act(form('Declare a conflict of interest'), 'He is my cousin; another operator should act.', 'Declare the conflict');
    expect(await screen.findByText('The conflict is recorded.')).toBeTruthy();
  });
});
