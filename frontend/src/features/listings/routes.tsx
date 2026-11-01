// Routes of the listing page (section 3.3): /listings/:id, for everyone. The listing editor (/sell) is U8-14.
import type { RouteObject } from 'react-router-dom';

export const listingRoutes: RouteObject[] = [
  { path: '/listings/:id', lazy: () => import('./ListingPage') },
];
