// One API client per document (docs/design/08_frontend.pdf, section 4.2). lib/api.js follows Unit 1's
// rules: HttpOnly cookies only, CSRF on state changes, one refresh for all tabs, step-up, problem
// documents. The staff console has its own cookies and refresh path, so a staff session and a user
// session in one browser never overwrite each other (I-51 a; FR-OPS-04).
import { createContext, useContext } from 'react';
import { createApi } from '../lib/api.js';

export type DocumentKind = 'user' | 'staff';
export type Api = ReturnType<typeof createApi>;
type ApiOptions = NonNullable<Parameters<typeof createApi>[0]>;

const STAFF: ApiOptions = {
  csrfCookie: '__Host-tb_scsrf',
  refreshPath: '/staff/auth/refresh',
  probePath: '/staff/me',
};

/**
 * `stepUp` obtains a grant for a step-up action (the user app's dialog). `overrides` are for tests
 * (fetch, cookies, locks, store); the application passes none.
 */
export function createDocumentApi(kind: DocumentKind, onSignedOut: () => void, overrides: ApiOptions = {},
  stepUp?: (action: string) => Promise<string>): Api {
  return createApi({ ...(kind === 'staff' ? STAFF : {}), stepUp, ...overrides, onSignedOut });
}

export const ApiContext = createContext<Api | null>(null);

export function useApi(): Api {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi outside the document root');
  return api;
}
