// One document of the client (section 3.1): its API client, its query cache, its router and the shell.
// Each entry (src/entries/) builds one with its own routes; moving to another document is a normal
// page load. Route rules only decide what the client offers; the server authorises every request
// (SEC-ACC-01).
import { StrictMode } from 'react';
import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { ApiContext, createDocumentApi, type Api, type DocumentKind } from './api';
import { LanguageProvider } from './language/Language';
import type { Lang } from './language/lang';
import { NotFound, RouteError } from './pages';
import { createQueryClient } from './query';
import { ME_KEY } from './me';
import { createSessionNotice, SessionContext, type SessionNotice } from './session';
import { createStepUpBroker, StepUpContext, type StepUpBroker } from './stepUp';
import { Shell, type ShellProps } from './Shell';

type Router = ReturnType<typeof createBrowserRouter>;

export interface DocumentSetup extends ShellProps {
  kind: DocumentKind;
  routes: RouteObject[];
  /**
   * After the session ends: where the user goes to sign in again, returning to `path` afterwards
   * (section 4.2). Without it, the notice is shown in place.
   */
  signIn?: (path: string, router: Router) => void;
}

export interface ClientDocument {
  api: Api;
  queryClient: QueryClient;
  router: Router;
  session: SessionNotice;
  stepUp: StepUpBroker;
}

interface Options {
  createRouter?: (routes: RouteObject[]) => Router;
  apiOverrides?: Parameters<typeof createDocumentApi>[2];
}

export function createDocument(setup: DocumentSetup, { createRouter = createBrowserRouter, apiOverrides }: Options = {}): ClientDocument {
  const queryClient = createQueryClient();
  const session = createSessionNotice();
  const stepUp = createStepUpBroker();
  // The callback runs only after a request, so the router below exists by then.
  const api = createDocumentApi(setup.kind, () => {
    // A guest's request answered 401 ended no session: nothing to clear, nothing to say (Decisions
    // log, U8-02). Someone was signed in when their account is in the cache.
    if (setup.kind === 'user' && queryClient.getQueryData(ME_KEY) === undefined) return;
    queryClient.clear();
    session.signedOut();
    if (setup.signIn) {
      const { pathname, search } = router.state.location;
      setup.signIn(pathname + search, router);
    }
  }, apiOverrides, setup.kind === 'user' ? stepUp.request : undefined);
  const router = createRouter([
    {
      element: <Shell titleKey={setup.titleKey} home={setup.home} accountLinks={setup.accountLinks} />,
      children: [
        {
          errorElement: <RouteError />,
          children: [...setup.routes, { path: '*', element: <NotFound home={setup.home} /> }],
        },
      ],
    },
  ]);
  return { api, queryClient, router, session, stepUp };
}

export function DocumentRoot({ doc, lang }: { doc: ClientDocument; lang?: Lang }) {
  return (
    <StrictMode>
      <LanguageProvider initial={lang}>
        <ApiContext.Provider value={doc.api}>
          <QueryClientProvider client={doc.queryClient}>
            <SessionContext.Provider value={doc.session}>
              <StepUpContext.Provider value={doc.stepUp}>
                <RouterProvider router={doc.router} />
              </StepUpContext.Provider>
            </SessionContext.Provider>
          </QueryClientProvider>
        </ApiContext.Provider>
      </LanguageProvider>
    </StrictMode>
  );
}

/** The path to sign in, returning to `path` afterwards. */
export const signInPath = (path: string) => `/signin?next=${encodeURIComponent(path)}`;

/** In the user app, sign-in is a route of the same document. */
export const signInHere: DocumentSetup['signIn'] = (path, router) => {
  void router.navigate(signInPath(path));
};

/** From the KYC page, sign-in is in the user app: a normal page load. */
export const signInInUserApp: DocumentSetup['signIn'] = (path) => {
  window.location.assign(signInPath(path));
};
