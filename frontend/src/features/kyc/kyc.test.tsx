// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, configure, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { fakeBackend, json, problem, renderDocument } from '../../testing/app';
import { CameraContext, type Camera } from './camera';
import { kycRoutes } from './routes';
import type { KycStatusView } from './model';

// The KYC wizard (IF-UI-02, NFR-USE-02, FR-KYC-01, FR-KYC-02, FR-KYC-06, FR-KYC-09; section 5.2).
// The camera is a stand-in here; the real one is the end-to-end run with Chromium's fake camera (U8-11).

configure({ asyncUtilTimeout: 3000 });   // the first lazy load of the wizard can take over a second

const status = (s: Partial<KycStatusView> = {}): KycStatusView => ({
  status: 'unsubmitted', changedAt: '2026-11-01T06:00:00Z', rejection: null, submissionsLeft: 3, expectedReviewHours: 24, ...s,
});
const challenge = (action = 'turn_head_left', id = 'ch-1') =>
  json(200, { challengeId: id, action, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });

function standInCamera(o: { denied?: boolean } = {}) {
  const streams: { stopped: boolean }[] = [];
  let n = 0;
  const camera: Camera = {
    open: async () => {
      if (o.denied) throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
      const s = { stopped: false };
      streams.push(s);
      return { getTracks: () => [{ stop: () => { s.stopped = true; } }] } as unknown as MediaStream;
    },
    capture: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, ++n])], { type: 'image/jpeg' }),
  };
  return { camera, streams };
}

function mount(be: ReturnType<typeof fakeBackend>, camera: Camera, lang: 'en' | 'bn' = 'en') {
  return renderDocument('/account/kyc', be, lang,
    { routes: kycRoutes, home: { path: '/', sameDocument: false }, titleKey: 'shell.document.kyc' },
    (root) => <CameraContext.Provider value={camera}>{root}</CameraContext.Provider>);
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const statusBar = () => screen.getByRole('region', { name: 'Your verification' });

async function takePhoto() {
  click('Start the camera');
  fireEvent.click(await screen.findByRole('button', { name: 'Take the photo' }));
  await screen.findByRole('button', { name: 'Take it again' });
}

async function fillDetails() {
  type('NID number', '১২৩৪ ৫৬৭৮৯০');
  type('Full name', ' Rahim  Uddin ');
  type('Date of birth', '1995-04-12');
  click('Continue');
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:tb-test', revokeObjectURL: () => {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('requirements and status', () => {
  it('NFR-USE-02 the requirements come before any capture, and the review status is shown on every step', async () => {
    const be = fakeBackend({ 'GET /kyc/status': json(200, status()) });
    mount(be, standInCamera().camera);
    expect(await screen.findByRole('heading', { name: 'What you need' })).toBeTruthy();
    expect(screen.getByText(/Your national ID card \(NID\) or your passport/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start the camera' })).toBeNull();
    expect(statusBar().textContent).toContain('Not verified yet.');

    click('Start');
    await screen.findByRole('heading', { name: 'Your document details' });
    expect(statusBar()).toBeTruthy();
    await fillDetails();
    await screen.findByRole('heading', { name: 'Front of your NID', level: 2 });
    expect(statusBar().textContent).toContain('Not verified yet.');
  });

  it('FR-KYC-06 a rejection shows its reason with what to do, and the note from the team as text', async () => {
    const be = fakeBackend({
      'GET /kyc/status': json(200, status({ status: 'rejected', rejection: { reason: 'image_unreadable', note: '<b>Back side</b> is blurred' }, submissionsLeft: 2 })),
    });
    mount(be, standInCamera().camera);
    await screen.findByText('Your last submission was not accepted.');
    expect(statusBar().textContent).toMatch(/blurred, cut off or too dark/);
    expect(screen.getByText('Note from our team: <b>Back side</b> is blurred')).toBeTruthy();
    expect(statusBar().querySelector('b')).toBeNull();
    expect(statusBar().textContent).toContain('You can submit 2 more times in 30 days.');
    expect(screen.getByRole('heading', { name: 'What you need' })).toBeTruthy();   // FR-KYC-09: it may be sent again
  });

  it('FR-KYC-06 duplicate identity is shown with its guidance; any reason the client does not know reads as the generic one', async () => {
    const be = fakeBackend({
      'GET /kyc/status': [
        json(200, status({ status: 'rejected', rejection: { reason: 'duplicate_identity', note: null } })),
      ],
    });
    mount(be, standInCamera().camera);
    expect(await screen.findByText(/already linked to another account. If that account is yours, sign in to it/)).toBeTruthy();
    cleanup();
    mount(fakeBackend({ 'GET /kyc/status': json(200, status({ status: 'rejected', rejection: { reason: 'blacklisted', note: null } })) }),
      standInCamera().camera);
    expect(await screen.findByText('We could not verify this identity. Contact support.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/blacklist/i);
  });

  it('FR-KYC-09 with no attempts left, or after revocation, there is no wizard', async () => {
    mount(fakeBackend({ 'GET /kyc/status': json(200, status({ status: 'rejected', rejection: { reason: 'other', note: null }, submissionsLeft: 0 })) }),
      standInCamera().camera);
    expect(await screen.findByText(/used every attempt for now/)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'What you need' })).toBeNull();
    cleanup();
    mount(fakeBackend({ 'GET /kyc/status': json(200, status({ status: 'revoked' })) }), standInCamera().camera);
    expect(await screen.findByText('Your verification was withdrawn. Contact support.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('IF-UI-02 a pending submission shows the expected review time in the page digits', async () => {
    mount(fakeBackend({ 'GET /kyc/status': json(200, status({ status: 'pending_review', expectedReviewHours: 24 })) }), standInCamera().camera, 'bn');
    expect(await screen.findByText(/২৪ ঘণ্টার মধ্যে/)).toBeTruthy();
  });

  it('IF-UI-02 without a session the page offers sign-in in the user app, returning here', async () => {
    mount(fakeBackend({ 'GET /kyc/status': problem(401, 'session-ended'), 'POST /auth/refresh': problem(401, 'session-ended') }),
      standInCamera().camera);
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe(`/signin?next=${encodeURIComponent('/account/kyc')}`);
  });
});

describe('the submission', () => {
  it('FR-KYC-01 an NID submission: details as printed, both sides, two selfies with the random action, sent once as multipart', async () => {
    let sent = false;
    const be = fakeBackend({
      'GET /kyc/status': () => json(200, status(sent ? { status: 'pending_review' } : {}))(),
      'GET /kyc/liveness-challenge': challenge('turn_head_left'),
      'POST /kyc/submissions': () => { sent = true; return json(202, { submissionId: 's-1', status: 'pending_review', expectedReviewHours: 24 })(); },
    });
    const cam = standInCamera();
    mount(be, cam.camera);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    await screen.findByRole('heading', { name: 'Your document details' });
    type('NID number', '12345');
    click('Continue');
    expect((await screen.findAllByText(/10, 13 or 17 digits/)).length).toBeGreaterThan(1);
    await fillDetails();

    await screen.findByRole('heading', { name: 'Front of your NID', level: 2 });
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);
    await takePhoto();
    click('Continue');
    await screen.findByRole('heading', { name: 'Back of your NID', level: 2 });
    await takePhoto();
    click('Continue');
    await screen.findByRole('heading', { name: 'Your selfie', level: 2 });
    await takePhoto();
    click('Continue');
    expect(await screen.findByText('Action: turn your head to the left')).toBeTruthy();
    await takePhoto();
    click('Continue');

    await screen.findByRole('heading', { name: 'Check and send' });
    expect(screen.getByText('1234567890')).toBeTruthy();
    expect(screen.getByText('Rahim  Uddin'.replace(/\s+/g, ' '))).toBeTruthy();
    expect(be.called('POST /kyc/submissions')).toEqual([]);           // nothing sent before the last step
    click('Send for review');

    expect(await screen.findByText('Waiting for review.')).toBeTruthy();
    const [submission] = be.called('POST /kyc/submissions');
    expect(be.called('POST /kyc/submissions')).toHaveLength(1);
    const form = submission.body as FormData;
    expect(Object.fromEntries(['docType', 'docNumber', 'fullName', 'dateOfBirth', 'challengeId'].map((k) => [k, form.get(k)]))).toEqual({
      docType: 'nid', docNumber: '1234567890', fullName: 'Rahim Uddin', dateOfBirth: '1995-04-12', challengeId: 'ch-1',
    });
    expect([...form.keys()].filter((k) => !['docType', 'docNumber', 'fullName', 'dateOfBirth', 'challengeId'].includes(k)))
      .toEqual(['doc_front', 'doc_back', 'selfie_neutral', 'selfie_action']);
    expect((form.get('doc_front') as File).type).toBe('image/jpeg');
    expect(submission.headers.get('Content-Type')).toBeNull();           // the browser sets the multipart boundary
    expect(submission.headers.get('X-CSRF-Token')).toBe('csrf-1');
    expect(cam.streams).toHaveLength(4);
    expect(cam.streams.every((x) => x.stopped)).toBe(true);              // the camera is released after each photo
  });

  it('FR-KYC-02 the images are kept only in memory: nothing is written to browser storage', async () => {
    // eslint-disable-next-line no-restricted-globals
    const storage = [localStorage, sessionStorage];
    storage.forEach((s) => s.clear());
    const be = fakeBackend({ 'GET /kyc/status': json(200, status()) });
    mount(be, standInCamera().camera);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await fillDetails();
    await takePhoto();
    expect(storage.map((s) => s.length)).toEqual([0, 0]);
  });

  it('FR-KYC-02 with the camera refused, a document may come from a file, but a selfie may not', async () => {
    const be = fakeBackend({ 'GET /kyc/status': json(200, status()), 'GET /kyc/liveness-challenge': challenge() });
    mount(be, standInCamera({ denied: true }).camera);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await fillDetails();

    click('Start the camera');
    expect(await screen.findByText(/The camera is blocked for this site/)).toBeTruthy();
    const file = screen.getByLabelText('Choose a photo of the document') as HTMLInputElement;
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'front.jpg', { type: 'image/jpeg' });
    fireEvent.change(file, { target: { files: [big] } });
    expect(await screen.findByText(/larger than 10 MB/)).toBeTruthy();
    fireEvent.change(file, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'front.png', { type: 'image/png' })] } });
    await screen.findByRole('button', { name: 'Take it again' });
    click('Continue');

    await screen.findByRole('heading', { name: 'Back of your NID', level: 2 });
    fireEvent.change(await (async () => { click('Start the camera'); return screen.findByLabelText('Choose a photo of the document'); })(),
      { target: { files: [new File([new Uint8Array([4])], 'back.webp', { type: 'image/webp' })] } });
    await screen.findByRole('button', { name: 'Take it again' });
    click('Continue');

    await screen.findByRole('heading', { name: 'Your selfie', level: 2 });
    click('Start the camera');
    expect(await screen.findByText(/must be taken live with the camera/)).toBeTruthy();
    expect(screen.queryByLabelText('Choose a photo of the document')).toBeNull();
    expect(document.querySelector('input[type=file]')).toBeNull();
  });

  it('FR-KYC-02 when the action has expired by the time of sending, a new action is asked and only that selfie is taken again', async () => {
    const be = fakeBackend({
      'GET /kyc/status': json(200, status()),
      'GET /kyc/liveness-challenge': [challenge('smile', 'ch-1'), challenge('look_up', 'ch-2')],
      'POST /kyc/submissions': [
        problem(400, 'validation-failed', { errors: [{ field: 'challengeId', reason: 'expired-or-used' }] }),
        json(202, { submissionId: 's-1', status: 'pending_review', expectedReviewHours: 24 }),
      ],
    });
    mount(be, standInCamera().camera);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    await fillDetails();
    for (const heading of ['Front of your NID', 'Back of your NID', 'Your selfie']) {
      await screen.findByRole('heading', { name: heading, level: 2 });
      await takePhoto();
      click('Continue');
    }
    expect(await screen.findByText('Action: smile')).toBeTruthy();
    await takePhoto();
    click('Continue');
    fireEvent.click(await screen.findByRole('button', { name: 'Send for review' }));

    expect(await screen.findByText(/The time for the action ran out/)).toBeTruthy();
    expect(await screen.findByText('Action: look up')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your selfie with an action', level: 2 })).toBeTruthy();
    await takePhoto();
    click('Continue');
    fireEvent.click(await screen.findByRole('button', { name: 'Send for review' }));
    await waitFor(() => expect(be.called('POST /kyc/submissions')).toHaveLength(2));
    expect((be.called('POST /kyc/submissions')[1].body as FormData).get('challengeId')).toBe('ch-2');
  });

  it('FR-KYC-01 a passport needs only its photo page and the two selfies', async () => {
    const be = fakeBackend({ 'GET /kyc/status': json(200, status()) });
    mount(be, standInCamera().camera);
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));
    fireEvent.click(await screen.findByLabelText('Passport'));
    type('Passport number', 'a0123456');
    type('Full name', 'Rahim Uddin');
    type('Date of birth', '1995-04-12');
    click('Continue');
    expect(await screen.findByRole('heading', { name: 'Your passport photo page', level: 2 })).toBeTruthy();
    expect(screen.getByText('Step 3 of 6')).toBeTruthy();
  });
});

describe('the images already sent', () => {
  it('SEC-ACC-06 they are shown only through the signed links Unit 1 gives', async () => {
    const be = fakeBackend({
      'GET /kyc/status': json(200, status({ status: 'pending_review' })),
      'POST /kyc/files/doc_front/view': json(200, { url: '/api/v1/files/v/tok-front', expiresAt: '2026-11-01T07:00:00Z' }),
      'POST /kyc/files/selfie_neutral/view': json(200, { url: 'https://evil.example/x.jpg', expiresAt: '2026-11-01T07:00:00Z' }),
    });
    mount(be, standInCamera().camera);
    fireEvent.click(await screen.findByRole('button', { name: 'Show the images you sent' }));
    const list = await screen.findByRole('list');
    const sources = within(list).getAllByRole('img').map((i) => i.getAttribute('src'));
    expect(sources).toEqual(['/api/v1/files/v/tok-front']);
  });
});
