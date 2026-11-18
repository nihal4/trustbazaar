// The console's routes (section 3.3; U8-10): the sign-in outside the console's frame, everything else inside it.
// /admin/* is the administrators' part (U8-10, third part).
import type { RouteObject } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import type { DocumentSetup } from '../shared/document';
import { DocumentTitle } from '../shared/pages';

/** An ended or missing staff session goes to the staff sign-in, which comes back here afterwards. */
export const staffSignIn: DocumentSetup['signIn'] = (path, router) => {
  if (router.state.location.pathname === '/staff/signin') return;
  void router.navigate(`/staff/signin?next=${encodeURIComponent(path)}`, { replace: true });
};

export const staffRoutes: RouteObject[] = [
  { path: '/staff/signin', lazy: () => import('./SignInPage') },
  {
    lazy: () => import('./Layout'),
    children: [
      { path: '/staff', lazy: () => import('./HomePage') },
      { path: '/staff/queues', element: <Navigate to="/staff/queues/disputes" replace /> },
      { path: '/staff/queues/:queue', lazy: () => import('./QueuesPage') },
      { path: '/staff/approvals', lazy: () => import('./ApprovalsPage') },
      { path: '/admin/*', element: <DocumentTitle titleKey="shell.document.staff" /> },
    ],
  },
];
