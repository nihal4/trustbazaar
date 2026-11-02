// Routes of the chat screens (section 3.3; IF-UI-07): /messages and /messages/:thread, for signed-in users.
import type { RouteObject } from 'react-router-dom';

export const chatRoutes: RouteObject[] = [
  { path: '/messages', lazy: () => import('./ThreadsPage') },
  { path: '/messages/:thread', lazy: () => import('./ThreadPage') },
];
