// Routes of home and search (section 3.3): / and /search, for everyone. Home has its own page (Daylight design,
// docs/design/10_visual.md, section 7.1); its search goes to /search, where the filters are in the URL.
import type { RouteObject } from 'react-router-dom';

export const searchRoutes: RouteObject[] = [
  { index: true, lazy: () => import('./HomePage') },
  { path: '/search', lazy: () => import('./SearchPage') },
];
