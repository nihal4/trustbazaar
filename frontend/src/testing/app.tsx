// Test support (not part of any bundle): a fake backend answering by method and path, the stand-in for
// GET /me (U1-13), and the user app mounted on a memory router.
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, type RouteObject } from 'react-router-dom';
import { accountRoutes } from '../features/account/routes';
import { notificationRoutes } from '../features/notifications/routes';
import { createDocument, DocumentRoot, signInHere } from '../shared/document';
import type { Me } from '../shared/me';

export interface Call { method: string; path: string; query: URLSearchParams; body: unknown; headers: Headers }
type Answer = (call: Call) => Response | Promise<Response>;

export const json = (status: number, body?: unknown, headers: Record<string, string> = {}) => () =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  });
export const problem = (status: number, name: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json(status, { type: `/problems/${name}`, title: name, status, ...extra }, headers);
export const noContent = () => () => new Response(null, { status: 204 });

/** A GET /me answer as U1-13 gives it. */
export const standInMe: Me = {
  id: '6f1c2b1e-0000-4000-8000-000000000001',
  displayName: 'Rahim',
  phoneMasked: '***678',
  email: 'rahim@example.com',
  emailVerified: true,
  kycStatus: 'unsubmitted',
  accountStatus: 'active',
  mfaEnabled: false,
};

/** Answers are keyed "METHOD /path" (under /api/v1); an answer may be a list, used in turn. */
export function fakeBackend(answers: Record<string, Answer | Answer[]>) {
  const calls: Call[] = [];
  const used: Record<string, number> = {};
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(url), 'https://tb.test');
    const path = u.pathname.replace(/^\/api\/v1/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : undefined;
    const call: Call = { method, path, query: u.searchParams, body, headers: new Headers(init.headers) };
    calls.push(call);
    const key = `${method} ${path}`;
    const a = answers[key];
    if (!a) return new Response(null, { status: 404 });
    const list = Array.isArray(a) ? a : [a];
    const i = Math.min(used[key] ?? 0, list.length - 1);
    used[key] = (used[key] ?? 0) + 1;
    return list[i](call);
  };
  return { calls, fetch: fetch as typeof globalThis.fetch, called: (key: string) => calls.filter((c) => `${c.method} ${c.path}` === key) };
}

export function renderApp(at: string, be: ReturnType<typeof fakeBackend>, lang: 'en' | 'bn' = 'en') {
  return renderDocument(at, be, lang, {
    home: { path: '/', sameDocument: true }, accountLinks: true,
    routes: [{ index: true, element: <h1>Home</h1> }, ...accountRoutes, ...notificationRoutes],
  });
}

/** Any user document (the user app, kyc.html) on a memory router; `wrap` adds providers around it. */
export function renderDocument(at: string, be: ReturnType<typeof fakeBackend>, lang: 'en' | 'bn',
  setup: { routes: RouteObject[]; home: { path: string; sameDocument: boolean }; accountLinks?: boolean; titleKey?: string },
  wrap: (root: ReactNode) => ReactNode = (r) => r) {
  const doc = createDocument(
    { kind: 'user', signIn: signInHere, ...setup },
    {
      createRouter: (r) => createMemoryRouter(r, { initialEntries: [at] }),
      apiOverrides: { fetch: be.fetch, cookies: () => '__Host-tb_csrf=csrf-1', locks: undefined, store: undefined },
    },
  );
  render(wrap(<DocumentRoot doc={doc} lang={lang} />));
  return doc;
}
