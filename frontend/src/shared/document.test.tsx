// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, type RouteObject } from 'react-router-dom';
import { ApiError } from '../lib/api.js';
import { createDocument, DocumentRoot, signInHere, type DocumentSetup } from './document';
import { readStoredLang } from './language/storage';
import { createQueryClient } from './query';

// The shell, the API client of each document and the language switch
// (docs/design/08_frontend.pdf, sections 3, 4.2, 4.3, 6.1 and 7).

interface Call { url: string; init: RequestInit }

/** A fake backend: answers by path; records every request. */
function backend(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const answer = answers[String(url).replace(/\?.*$/, '')];
    return answer ? answer() : new Response(null, { status: 404 });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name);

const Page = ({ title }: { title: string }) => <><h1>{title}</h1><Link to="/next">next</Link></>;

function mount(setup: Partial<DocumentSetup>, opts: { at?: string; lang?: 'en' | 'bn'; fetch?: typeof globalThis.fetch; cookies?: string } = {}) {
  const routes: RouteObject[] = setup.routes ?? [
    { index: true, element: <Page title="Home" /> },
    { path: '/orders/:id', element: <Page title="Order" /> },
    { path: '/next', element: <Page title="Next" /> },
  ];
  const doc = createDocument(
    { kind: 'user', home: { path: '/', sameDocument: true }, ...setup, routes },
    {
      createRouter: (r) => createMemoryRouter(r, { initialEntries: [opts.at ?? '/'] }),
      apiOverrides: { fetch: opts.fetch, cookies: () => opts.cookies ?? '', locks: undefined, store: undefined },
    },
  );
  render(<DocumentRoot doc={doc} lang={opts.lang} />);
  return doc;
}

// The tests inspect browser storage to prove what the client keeps there (section 8.2).
// eslint-disable-next-line no-restricted-globals
const storage = () => localStorage;

beforeEach(() => {
  try { storage().clear(); } catch { /* none */ }
  document.documentElement.lang = '';
});
afterEach(cleanup);

describe('language switch', () => {
  it('NFR-USE-04 the header switches the whole page between English and Bangla, at any time', async () => {
    mount({}, { at: '/nowhere', lang: 'en' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');

    fireEvent.click(screen.getByRole('button', { name: 'Change the language to Bangla' }));

    expect(await screen.findByRole('heading', { name: 'পৃষ্ঠাটি পাওয়া যায়নি' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('bn');
    expect(screen.getByRole('button', { name: 'ভাষা ইংরেজিতে বদলান' }).textContent).toBe('English');
    expect(readStoredLang()).toBe('bn');
  });

  it('NFR-USE-04 the switch names the other language in that language', async () => {
    mount({}, { lang: 'en' });
    const name = await screen.findByText('বাংলা');
    expect(name.getAttribute('lang')).toBe('bn');
  });

  it('NFR-USE-04 the kept choice is used on the next visit', async () => {
    mount({}, { lang: 'en' });
    fireEvent.click(await screen.findByRole('button', { name: 'Change the language to Bangla' }));
    cleanup();
    mount({});
    expect(await screen.findByRole('link', { name: 'TrustBazaar হোম' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('bn');
  });

  it('NFR-USE-04 every shared page has a Bangla text: the console and KYC titles', async () => {
    mount({ titleKey: 'shell.document.staff', kind: 'staff' }, { lang: 'bn' });
    expect(await screen.findByText('স্টাফ কনসোল')).toBeTruthy();
  });
});

describe('the API client of each document', () => {
  it('SEC-SES-03 the user app sends cookies only: no Authorization header and nothing stored', async () => {
    const be = backend({ '/api/v1/orders': json(200, []) });
    const doc = mount({}, { fetch: be.fetch, cookies: '__Host-tb_csrf=user-csrf' });
    await doc.api.get('/orders');
    await doc.api.post('/orders', { listingId: 'l1' });
    for (const c of be.calls) {
      expect(c.init.credentials).toBe('same-origin');
      expect(header(c, 'Authorization')).toBeNull();
    }
    expect(storage().length).toBe(0);
  });

  it('SEC-SES-04 the user app copies the user CSRF cookie on state changes only', async () => {
    const be = backend({ '/api/v1/orders': json(200, []) });
    const doc = mount({}, { fetch: be.fetch, cookies: '__Host-tb_scsrf=staff-csrf; __Host-tb_csrf=user-csrf' });
    await doc.api.get('/orders');
    await doc.api.post('/orders', {});
    expect(header(be.calls[0], 'X-CSRF-Token')).toBeNull();
    expect(header(be.calls[1], 'X-CSRF-Token')).toBe('user-csrf');
  });

  it('I-51 the console uses the staff cookies and the staff refresh path, never the user session', async () => {
    const be = backend({
      '/api/v1/staff/approvals': json(401, { type: '/problems/unauthenticated' }),
      '/api/v1/staff/me': json(401, {}),
      '/api/v1/staff/auth/refresh': json(401, {}),
    });
    const doc = mount({ kind: 'staff', home: { path: '/staff', sameDocument: true } },
      { fetch: be.fetch, cookies: '__Host-tb_csrf=user-csrf; __Host-tb_scsrf=staff-csrf' });
    await expect(doc.api.get('/staff/approvals')).rejects.toBeInstanceOf(ApiError);
    const paths = be.calls.map((c) => new URL(c.url, 'https://tb.test').pathname);
    expect(paths).toEqual(['/api/v1/staff/approvals', '/api/v1/staff/me', '/api/v1/staff/auth/refresh']);
    expect(header(be.calls[2], 'X-CSRF-Token')).toBe('staff-csrf');
    expect(paths).not.toContain('/api/v1/auth/refresh');
  });
});

describe('when the session ends', () => {
  const ended = () => backend({
    '/api/v1/orders/7': json(401, {}),
    '/api/v1/me': json(401, {}),
    '/api/v1/auth/refresh': json(401, {}),
  });

  it('SEC-SES-03 a refused refresh clears every cached answer, says so, and goes to sign-in returning here', async () => {
    const be = ended();
    const doc = mount({ signIn: signInHere }, { at: '/orders/7?tab=chat', fetch: be.fetch, lang: 'en' });
    doc.queryClient.setQueryData(['orders', '7'], { total: '1255000' });
    doc.queryClient.setQueryData(['me'], { name: 'Previous user' });

    await act(async () => { await expect(doc.api.get('/orders/7')).rejects.toBeInstanceOf(ApiError); });

    expect(doc.queryClient.getQueryCache().getAll()).toEqual([]);
    expect((await screen.findByRole('alert')).textContent).toContain('You have been signed out');
    await waitFor(() => expect(doc.router.state.location.pathname).toBe('/signin'));
    expect(doc.router.state.location.search).toBe(`?next=${encodeURIComponent('/orders/7?tab=chat')}`);
  });

  it('SEC-SES-03 without a sign-in route in the document, the notice is shown in place', async () => {
    const be = ended();
    const doc = mount({}, { at: '/orders/7', fetch: be.fetch, lang: 'bn' });
    await act(async () => { await doc.api.get('/orders/7').catch(() => undefined); });
    expect((await screen.findByRole('alert')).textContent).toContain('আপনি সাইন আউট হয়ে গেছেন');
    expect(doc.router.state.location.pathname).toBe('/orders/7');
    fireEvent.click(screen.getByRole('button', { name: 'বন্ধ করুন' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('server state', () => {
  it('DV-56 nothing is fresh by default, queries refetch on focus and reconnect, and a state change is never retried', () => {
    const d = createQueryClient().getDefaultOptions();
    expect(d.queries?.staleTime).toBe(0);
    expect(d.queries?.refetchOnWindowFocus).toBe(true);
    expect(d.queries?.refetchOnReconnect).toBe(true);
    expect(d.mutations?.retry).toBe(false);
    const retry = d.queries?.retry as (n: number, e: unknown) => boolean;
    expect(retry(0, new ApiError(0, {}))).toBe(true);
    expect(retry(2, new ApiError(0, {}))).toBe(false);
    expect(retry(0, new ApiError(409, {}))).toBe(false);
    expect(retry(0, new ApiError(500, {}))).toBe(false);
  });
});

describe('keyboard and screen readers', () => {
  it('NFR-USE-06 a skip link leads to the main region', async () => {
    mount({}, { lang: 'en' });
    const skip = await screen.findByRole('link', { name: 'Skip to main content' });
    expect(skip.getAttribute('href')).toBe('#main');
    expect(document.getElementById('main')?.tagName).toBe('MAIN');
  });

  it('NFR-USE-06 after a navigation, focus moves to the new page', async () => {
    mount({}, { lang: 'en' });
    const link = await screen.findByRole('link', { name: 'next' });
    expect(document.activeElement).not.toBe(document.getElementById('main'));
    fireEvent.click(link);
    expect(await screen.findByRole('heading', { name: 'Next' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main')));
  });

  it('SEC-INP-06 an unknown path shows the generic not-found message with a way home', async () => {
    mount({ home: { path: '/', sameDocument: false } }, { at: '/staff/nothing', lang: 'en' });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/');
  });
});
