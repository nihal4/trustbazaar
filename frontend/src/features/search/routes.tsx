// Routes of home and search (section 3.3): / and /search, for everyone. The same page; the filters are in the URL.
import type { RouteObject } from 'react-router-dom';

export const searchRoutes: RouteObject[] = [
  { index: true, lazy: () => import('./SearchPage') },
  { path: '/search', lazy: () => import('./SearchPage') },
];
